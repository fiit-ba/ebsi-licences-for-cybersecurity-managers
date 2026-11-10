import { ZeroAddress } from 'ethers';
import { IssuanceError } from '../issuance/claims.ts';

export const policyKinds = ['suspend', 'revoke', 'reinstate', 'admin'] as const;
export const governanceRoles = 'ABCDEFGH'.split('');
/** Existing contract policy kind. */
export type PolicyKind = (typeof policyKinds)[number];
/** Public contract quorum policy, including the minimum number of distinct signer roles. */
export interface GovernancePolicy {
  threshold: number;
  requiredRoles: string[];
  vetoRoles: string[];
  timelock: number;
}
/** Configuration observed on the actual governance deployment. */
export interface GovernanceConfiguration {
  signers: { address: string; role: string }[];
  /** Roles signed for from outside the TI, by any valid key of a cosigner's DID (C). */
  cosignerRoles?: string[];
  policies: Record<PolicyKind, GovernancePolicy>;
  rolesPresent: string[];
  proposalTtl: number;
  version: number;
}
/** Existing administration proposal payloads consumed by the console. */
export type AdminChange =
  | { action: 'add_signer'; subject: string; role: string }
  | { action: 'remove_signer'; subject: string }
  | { action: 'replace_signer'; subject: string; replacement: string }
  | {
      action: 'set_policy';
      kind: PolicyKind;
      threshold: number;
      required_roles: string[];
      veto_roles: string[];
      timelock: number;
    }
  | { action: 'set_proposal_ttl'; ttl: number };
/** Body-key bounds configured by the original backend. */
export interface GovernanceBounds {
  timelock: Record<PolicyKind, [number, number]>;
  ttl: [number, number];
  min_threshold: number;
}

/**
 * Read the policy bounds, without changing contract configuration.
 * @param env - Environment settings.
 * @returns Whole-second limits shown by the existing roles API.
 * @throws Error for malformed bounds.
 */
export function governanceBounds(env = process.env): GovernanceBounds {
  const bounds: GovernanceBounds = {
    timelock: {
      suspend: [0, 0],
      reinstate: [0, 0],
      revoke: [
        Number(env.PLR_GOVERNANCE_TIMELOCK_MIN_SECONDS ?? 86400),
        Number(env.PLR_GOVERNANCE_TIMELOCK_MAX_SECONDS ?? 172800),
      ],
      admin: [0, Number(env.PLR_GOVERNANCE_ADMIN_TIMELOCK_MAX_SECONDS ?? 604800)],
    },
    ttl: [
      Number(env.PLR_GOVERNANCE_TTL_MIN_SECONDS ?? 86400),
      Number(env.PLR_GOVERNANCE_TTL_MAX_SECONDS ?? 7776000),
    ],
    min_threshold: 2,
  };
  for (const [low, high] of [...Object.values(bounds.timelock), bounds.ttl])
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 0 || high < low)
      throw new Error('Invalid governance policy bounds.');
  return bounds;
}

/**
 * Refuse a body-key policy action with the public reason.
 * @param reason - Existing refusal identifier.
 * @param detail - Public explanation containing no secrets.
 * @returns Never returns.
 * @throws IssuanceError with HTTP 403.
 */
function refuse(reason: string, detail: string): never {
  throw new IssuanceError(403, reason, detail);
}

/**
 * Normalize the existing administration change fields before any chain operation.
 * @param input - Untrusted console JSON.
 * @returns A validated administration change.
 * @throws IssuanceError for malformed fields.
 */
export function adminChange(input: Record<string, unknown>): AdminChange {
  const integer = (key: string, max: number) => {
    const raw = input[key];
    const value =
      typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
      throw new IssuanceError(400, 'InvalidFields', `Invalid ${key}.`);
    return value;
  };
  const address = (key: string) => {
    const value = String(input[key]);
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value;
    throw new IssuanceError(400, 'InvalidFields', `Invalid ${key}.`);
  };
  const roles = (key: string) => {
    const values = input[key] ?? [];
    if (!Array.isArray(values) || values.some((value) => !governanceRoles.includes(value)))
      throw new IssuanceError(400, 'InvalidFields', `Invalid ${key}.`);
    return [...new Set(values as string[])].sort();
  };
  switch (input.action) {
    case 'add_signer':
      if (!governanceRoles.includes(String(input.signer_role ?? input.role)))
        throw new IssuanceError(400, 'InvalidFields', 'Invalid role.');
      return {
        action: input.action,
        subject: address('subject'),
        role: String(input.signer_role ?? input.role),
      };
    case 'remove_signer':
      return { action: input.action, subject: address('subject') };
    case 'replace_signer':
      return {
        action: input.action,
        subject: address('subject'),
        replacement: address('replacement'),
      };
    case 'set_proposal_ttl':
      return { action: input.action, ttl: integer('ttl', Number.MAX_SAFE_INTEGER) };
    case 'set_policy':
      if (!policyKinds.includes(input.kind as PolicyKind))
        throw new IssuanceError(400, 'InvalidFields', 'Invalid kind.');
      return {
        action: input.action,
        kind: input.kind as PolicyKind,
        threshold: integer('threshold', 8),
        required_roles: roles('required_roles'),
        veto_roles: roles('veto_roles'),
        timelock: integer('timelock', Number.MAX_SAFE_INTEGER),
      };
    default:
      throw new IssuanceError(400, 'InvalidFields', 'Unknown administration action.');
  }
}

/**
 * Assess the certification body’s policy bounds, in addition to contract simulation.
 * @param change - Validated existing administration change.
 * @param config - Current chain configuration, not a locally cached rule.
 * @param bounds - configured body-key bounds.
 * @returns Weakening reason codes and public explanations; empty means no supervisory prerequisite.
 * @throws IssuanceError for changes the body's keys never sign.
 */
export function assessAdminChange(
  change: AdminChange,
  config: GovernanceConfiguration,
  bounds = governanceBounds(),
) {
  const present = new Set(config.rolesPresent);
  const signers = new Map(
    config.signers.map((signer) => [signer.address.toLowerCase(), signer.role]),
  );
  const reasons: { code: string; detail: string }[] = [];
  if (change.action === 'set_policy') {
    if (!policyKinds.includes(change.kind)) refuse('UnsupportedChange', 'Unknown policy kind.');
    const current = config.policies[change.kind];
    const required = new Set(change.required_roles);
    const veto = new Set(change.veto_roles);
    if (change.threshold < bounds.min_threshold)
      refuse('ThresholdTooLow', 'A threshold below 2 lets one role decide alone.');
    if (change.threshold > present.size)
      refuse('InvalidThreshold', `Only ${present.size} roles hold a key.`);
    if ([...required].some((role) => !present.has(role)))
      refuse('RoleWithoutKey', 'A required role holds no key.');
    if (required.size > change.threshold)
      refuse('InvalidPolicy', 'More roles are required than the threshold counts.');
    if (![...veto].some((role) => present.has(role)))
      refuse('NoVetoRole', 'No role that holds a key could veto this decision.');
    const [low, high] = bounds.timelock[change.kind];
    if (change.timelock < low || change.timelock > high)
      refuse(
        'TimelockOutOfRange',
        `The ${change.kind} timelock must be between ${low} and ${high} seconds.`,
      );
    const droppedRequired = current.requiredRoles.some((role) => !required.has(role));
    const droppedVeto = current.vetoRoles.some((role) => !veto.has(role));
    if (
      change.threshold === current.threshold &&
      change.timelock === current.timelock &&
      !droppedRequired &&
      required.size === current.requiredRoles.length &&
      !droppedVeto &&
      veto.size === current.vetoRoles.length
    )
      refuse('NoChange', `The ${change.kind} policy is already set that way.`);
    if (change.threshold < current.threshold)
      reasons.push({
        code: 'LowerThreshold',
        detail: 'Lowering the threshold loosens the multisig.',
      });
    if (droppedRequired)
      reasons.push({
        code: 'DroppedRole',
        detail: 'Dropping a required role loosens the multisig.',
      });
    if (change.timelock < current.timelock)
      reasons.push({
        code: 'ShorterTimelock',
        detail: 'Shortening the timelock loosens protection.',
      });
    if (droppedVeto)
      reasons.push({ code: 'DroppedVeto', detail: 'Removing a veto loosens protection.' });
    if (change.threshold === present.size && change.threshold !== current.threshold)
      reasons.push({ code: 'Unanimity', detail: 'Unanimity makes every role irreplaceable.' });
    return reasons;
  }
  if (change.action === 'set_proposal_ttl') {
    if (change.ttl < bounds.ttl[0] || change.ttl > bounds.ttl[1])
      refuse('TtlOutOfRange', 'Proposal TTL is outside the configured bounds.');
    if (change.ttl === config.proposalTtl)
      refuse('NoChange', 'Proposals already stay open that long.');
    return reasons;
  }
  const subject = change.subject.toLowerCase();
  if (change.action === 'add_signer') {
    if (!governanceRoles.includes(change.role)) refuse('InvalidRole', 'Unknown signer role.');
    if (signers.has(subject)) refuse('DuplicateSigner', 'That key is already a signer.');
    return [
      {
        code: 'NewSigner',
        detail: `A new key for role ${change.role} is a new way to reach quorum.`,
      },
    ];
  }
  const role = signers.get(subject);
  if (!['remove_signer', 'replace_signer'].includes(change.action))
    refuse('UnsupportedChange', 'Unknown administration change.');
  if (!role) refuse('InvalidSigner', 'That key is not a signer.');
  if (change.action === 'replace_signer') {
    if (signers.has(change.replacement.toLowerCase()) || change.replacement === ZeroAddress)
      refuse('DuplicateSigner', 'The new key must not already be a signer.');
    return role === 'C'
      ? [{ code: 'SupervisorKey', detail: 'The supervisory authority rotates its own key.' }]
      : reasons;
  }
  // As the contract counts them: the TI's other keys and its cosigners' roles.
  const remaining = new Set([
    ...[...signers].filter(([address]) => address !== subject).map(([, value]) => value),
    ...(config.cosignerRoles ?? []),
  ]);
  if (role === 'C' && !remaining.has('C'))
    refuse('SupervisorRemoval', 'The body cannot remove the supervisory authority.');
  for (const policy of Object.values(config.policies))
    if (
      remaining.size < policy.threshold ||
      policy.requiredRoles.some((required) => !remaining.has(required)) ||
      !policy.vetoRoles.some((veto) => remaining.has(veto))
    )
      refuse('Unsatisfiable', 'Without this key a policy could not be met or vetoed.');
  return [
    {
      code: 'RemovedSigner',
      detail: `Removing a key of role ${role} changes who can reach quorum.`,
    },
  ];
}

/**
 * Require supervisory approval before a body-key signature for a body-key signature.
 * @param change - Validated change.
 * @param config - Fresh chain configuration.
 * @param role - Current signing role.
 * @param signedRoles - Roles already observed on this proposal; empty when proposing.
 * @param bounds - Configured body-key policy limits.
 * @returns Weakening reasons for the existing check response.
 * @throws IssuanceError when the change is refused or requires the supervisor first.
 */
export function checkAdminChange(
  change: AdminChange,
  config: GovernanceConfiguration,
  role: string,
  signedRoles: string[] = [],
  bounds = governanceBounds(),
) {
  const reasons = assessAdminChange(change, config, bounds);
  if (reasons.length && role !== 'C' && !signedRoles.includes('C'))
    refuse(
      'SupervisorFirst',
      reasons.map((reason) => reason.detail).join(' ') +
        ' The supervisory authority must sign first.',
    );
  return reasons;
}
