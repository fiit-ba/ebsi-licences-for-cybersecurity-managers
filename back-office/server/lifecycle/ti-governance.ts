import { readFileSync } from 'node:fs';
import {
  Contract,
  getAddress,
  isError,
  keccak256,
  toUtf8Bytes,
  type Provider,
  type Signer,
} from 'ethers';
import type { Pool } from 'pg';
import { GOVERNANCE_ABI } from '../../shared/governance-contract.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { jwkAddress } from '../ebsi/runtime.ts';

/** The roles of component 10.2, as the contract numbers them. */
const roles = { A: 1, B: 2, C: 3 } as const;
const kinds = ['suspend', 'revoke', 'reinstate', 'admin'] as const;

/** One policy as contracts/config/*.json writes it. */
interface PolicyText {
  threshold: number;
  requiredRoles?: (keyof typeof roles)[];
  vetoRoles: (keyof typeof roles)[];
  timelock?: number;
}

/** A TI's rules as contracts/config/*.json writes them. */
export interface TiRules {
  policies: Record<(typeof kinds)[number], PolicyText>;
  proposalTtl: number;
}

/**
 * The pilot rules of contracts/config/pilot.json: two of the three roles for every decision,
 * a 24 h timelock on a revocation, rule changes applied at quorum, every role may veto,
 * proposals open for 30 days.
 */
export const pilotRules: TiRules = {
  policies: {
    suspend: { threshold: 2, requiredRoles: [], vetoRoles: ['A', 'B', 'C'], timelock: 0 },
    revoke: { threshold: 2, requiredRoles: [], vetoRoles: ['A', 'B', 'C'], timelock: 86400 },
    reinstate: { threshold: 2, requiredRoles: [], vetoRoles: ['A', 'B', 'C'], timelock: 0 },
    admin: { threshold: 2, requiredRoles: [], vetoRoles: ['A', 'B', 'C'], timelock: 0 },
  },
  proposalTtl: 2592000,
};

/**
 * Read a TI's rules: a contracts/config/*.json file, or the pilot rules.
 * @param file - Optional path, `PLR_TI_GOVERNANCE_CONFIG`.
 * @returns The rules.
 * @throws Error for an unreadable file or a policy without veto roles.
 */
export function tiRules(file?: string): TiRules {
  if (!file) return pilotRules;
  const rules = JSON.parse(readFileSync(file, 'utf8')) as TiRules;
  for (const kind of kinds)
    if (!rules.policies?.[kind] || !Array.isArray(rules.policies[kind].vetoRoles))
      throw new Error(`${file} names no ${kind} policy with veto roles.`);
  if (!Number.isSafeInteger(rules.proposalTtl)) throw new Error(`${file} names no proposalTtl.`);
  return rules;
}

/**
 * The id the governance contract keeps a TI under: keccak256 of its DID.
 * @param did - TI DID.
 * @returns The 0x-hex id.
 */
export function tiIdOf(did: string) {
  return keccak256(toUtf8Bytes(did));
}

const mask = (letters: (keyof typeof roles)[] = []) =>
  letters.reduce((value, letter) => value | (1 << (roles[letter] - 1)), 0);

/**
 * Set TIs up on the governance contract as their TAO: their A and B keys, the supervisory
 * authority as role C, and the configured rules (`addTi`).
 *
 * @param database - PostgreSQL pool.
 * @param options - Governance address, read provider, the TAO's audited ledger signer, rules
 * and the supervisory authority's DID.
 * @returns The idempotent setup operation.
 * @remarks The contract checks what the back-office cannot vouch for: that the TI is the TAO's
 * live accreditation in the Trusted Issuers Registry and that every key is a valid key of the
 * TI's DID. One contract serves one TAO; a TI of another TAO stays unconfigured.
 */
export function tiGovernanceSetup(
  database: Pool,
  options: {
    governance: string;
    provider: Provider;
    taoSigner(organizationId: string): Promise<Signer>;
    rules: TiRules;
    supervisorDid?: string;
  },
) {
  const address = getAddress(options.governance);
  const reader = new Contract(address, GOVERNANCE_ABI, options.provider);

  return {
    /**
     * Set one TI up, once per contract: the contract is asked whether it knows the TI.
     * @param organizationId - TI organization UUID.
     * @returns `configured` once the contract knows the TI, or `pending` with the reason.
     * @throws RPC, KMS or contract errors from the setup transaction.
     */
    async ensure(
      organizationId: string,
    ): Promise<{ state: 'configured' } | { state: 'pending'; reason: string }> {
      const {
        rows: [ti],
      } = await database.query(
        `SELECT ti.id,ti.did,ti.tir_attribute_id,ti.governance_configured_at,tao.id AS tao_id,tao.did AS tao_did
         FROM accredited_organizations ti JOIN accredited_organizations tao ON tao.id=ti.parent_id
         WHERE ti.id=$1 AND ti.kind='ti'`,
        [organizationId],
      );
      if (!ti?.did || !/^0x[0-9a-f]{64}$/.test(ti.tir_attribute_id ?? ''))
        return {
          state: 'pending',
          reason: 'The TI is not accredited in the Trusted Issuers Registry yet.',
        };
      // The chain decides, not the flag: a contract deployed again knows no TI yet.
      const tiId = tiIdOf(ti.did);
      const known = await reader.getTi(tiId).then(
        () => true,
        (error: unknown) => {
          if (isError(error, 'CALL_EXCEPTION')) return false;
          throw error;
        },
      );
      let added = false;
      if (!known) {
        if ((await reader.taoDid()) !== ti.tao_did)
          return { state: 'pending', reason: 'The governance contract belongs to another TAO.' };
        const tao = await options.taoSigner(ti.tao_id);
        if ((await reader.owner()) !== (await tao.getAddress()))
          return {
            state: 'pending',
            reason: "The TAO's key does not own the governance contract yet.",
          };
        const { rows: keys } = await database.query(
          `SELECT purpose,public_jwk FROM issuer_signing_keys WHERE organization_id=$1 AND active
           AND purpose IN ('governance_role_a','governance_role_b') ORDER BY purpose`,
          [organizationId],
        );
        if (keys.length !== 2)
          return { state: 'pending', reason: 'The TI has no active A and B keys.' };
        const setup = {
          did: ti.did,
          attributeId: ti.tir_attribute_id,
          signers: keys.map((key) => jwkAddress(key.public_jwk)),
          roles: keys.map((key) => (key.purpose === 'governance_role_a' ? roles.A : roles.B)),
          cosigners: options.supervisorDid ? [{ did: options.supervisorDid, role: roles.C }] : [],
          policies: kinds.map((kind) => {
            const policy = options.rules.policies[kind];
            return {
              threshold: policy.threshold,
              requiredRoleMask: mask(policy.requiredRoles),
              vetoRoleMask: mask(policy.vetoRoles),
              timelock: policy.timelock ?? 0,
            };
          }),
          proposalTtl: options.rules.proposalTtl,
        };
        const writer = new Contract(address, GOVERNANCE_ABI, tao);
        try {
          const sent = await writer.addTi(setup);
          const receipt = await sent.wait(1, 120_000);
          if (!receipt || receipt.status !== 1) throw new Error('The TI setup was not confirmed.');
        } catch (error) {
          // A lost response may still have set the TI up.
          const after = await reader.getTi(tiId).then(
            () => true,
            () => false,
          );
          if (!after) throw error;
        }
        added = true;
      }
      if (ti.governance_configured_at && !added) return { state: 'configured' };
      await transaction(database, async (client) => {
        const { rowCount } = await client.query(
          'UPDATE accredited_organizations SET governance_configured_at=clock_timestamp() WHERE id=$1 AND (governance_configured_at IS NULL OR $2)',
          [organizationId, added],
        );
        if (rowCount)
          await appendAudit(client, {
            event: 'organization.governance_configured',
            organizationId,
            detail: { ti_id: tiId, contract: address },
          });
      });
      return { state: 'configured' };
    },
  };
}

/** Idempotent per-TI governance setup. */
export type TiGovernanceSetup = ReturnType<typeof tiGovernanceSetup>;
