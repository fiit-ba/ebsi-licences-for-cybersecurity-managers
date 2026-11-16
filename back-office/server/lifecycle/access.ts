import type { PoolClient } from 'pg';
import { IssuanceError } from '../issuance/claims.ts';

// Aliases are shared by the registry and proposal queries. $1 is the operator.
export const certificateOrganizations = `
  JOIN accredited_organizations ti ON ti.id = c.issuer_id
  JOIN accredited_organizations tao ON tao.id = ti.parent_id
  JOIN accredited_organizations root ON root.id = tao.parent_id
`;

// Ordinary lifecycle authority is registry-wide; emergency scope is independent.
const operatorContext = `
  FROM operator_accounts a JOIN operator_roles r ON r.account_id = a.id
  LEFT JOIN accredited_organizations owner ON owner.account_id = a.id
  LEFT JOIN accredited_organizations parent ON parent.id = owner.parent_id
  LEFT JOIN accredited_organizations ancestor ON ancestor.id = parent.parent_id
`;
const activeOperator = `
  a.id = $1 AND a.active AND NOT EXISTS (
    SELECT 1 FROM (VALUES (owner.revoked_at), (parent.revoked_at), (ancestor.revoked_at)) chain(revoked_at)
    WHERE revoked_at <= statement_timestamp()
  )
`;
const currentStatusManager = `
  ${operatorContext} WHERE ${activeOperator} AND r.role = 'plr_status_manager'
`;

export const statusManagerAccess = `EXISTS (SELECT 1 ${currentStatusManager})`;

export const certificateReaderAccess = `
  EXISTS (
    SELECT 1 ${operatorContext}
    WHERE ${activeOperator} AND (
      r.role IN ('plr_issuer', 'plr_status_manager', 'plr_auditor')
      OR (r.role = 'plr_rtao' AND owner.kind = 'rtao')
      OR (r.role = 'plr_tao' AND owner.kind = 'tao' AND ti.parent_id = owner.id)
    )
  )
`;

export const pendingEmergency = `EXISTS (
  SELECT 1 FROM certificate_emergency_suspensions emergency
  WHERE emergency.certificate_id = c.id AND emergency.applied_at IS NULL
)`;

export const emergencyAccess = `EXISTS (
  SELECT 1 ${operatorContext}
  WHERE ${activeOperator} AND (
    (r.role = 'plr_rtao' AND owner.kind = 'rtao')
    OR (r.role = 'plr_tao' AND owner.kind = 'tao' AND ti.parent_id = owner.id)
    OR (r.role = 'plr_status_manager' AND owner.kind = 'ti' AND ti.id = owner.id)
  )
)`;

export const observedStanding = `
  CASE WHEN ${pendingEmergency} THEN 'unknown'
    WHEN NOT EXISTS (
      SELECT 1 FROM credential_tokens collected WHERE collected.certificate_id = c.id AND collected.redeemed_at IS NOT NULL
    ) THEN c.local_standing
    WHEN c.ledger_observed_at > clock_timestamp() - interval '180 seconds'
    THEN c.ledger_standing ELSE 'unknown' END
`;

/**
 * Select the authoritative decision standing for the configured lifecycle mode.
 * @param governanceEnabled - Captured execution mode; admission is independent of this mode.
 * @returns The committed local state using certificate alias c.
 * @remarks lifecycle decisions remain available during ledger outages. Contract
 * execution and verification independently read the ledger; this is not proof of execution.
 */
export function lifecycleStanding(governanceEnabled: boolean): string {
  void governanceEnabled;
  return 'c.local_standing';
}

/** Locked organization identity and revocation fields used for lifecycle authorization. */
interface Organization {
  id: string;
  parent_id: string | null;
  account_id: number | null;
  revoked_at: Date | null;
}

/**
 * Lock and revalidate the issuer hierarchy from root to leaf.
 *
 * @param client - Connection participating in the caller's transaction.
 * @param issuerId - TI organization UUID.
 * @returns RootTAO, TAO, TI and whether any chain member is revoked.
 * @throws IssuanceError if the issuer or hierarchy is unavailable; database errors.
 * @remarks The lock order matches accreditation changes and locks remain until transaction end.
 */
export async function lockIssuerChain(client: PoolClient, issuerId: string) {
  const {
    rows: [path],
  } = await client.query<{ tao_id: string; root_id: string }>(
    `
    SELECT tao.id AS tao_id, tao.parent_id AS root_id
    FROM accredited_organizations ti
    JOIN accredited_organizations tao ON tao.id = ti.parent_id
    WHERE ti.id = $1 AND ti.kind = 'ti'
  `,
    [issuerId],
  );
  if (!path) throw new IssuanceError(403, 'NotYours', 'The issuer is unavailable.');

  const organizations: Organization[] = [];
  for (const id of [path.root_id, path.tao_id, issuerId]) {
    const {
      rows: [organization],
    } = await client.query<Organization>(
      'SELECT id, parent_id, account_id, revoked_at FROM accredited_organizations WHERE id = $1 FOR SHARE',
      [id],
    );
    organizations.push(organization);
  }
  const [root, tao, ti] = organizations;
  if (!root || !tao || !ti || ti.parent_id !== tao.id || tao.parent_id !== root.id) {
    throw new IssuanceError(403, 'NotYours', 'The issuer trust chain changed.');
  }
  return {
    root,
    tao,
    ti,
    revoked: organizations.some((row) => row.revoked_at && +row.revoked_at <= Date.now()),
  };
}

/**
 * Lock and revalidate the organization's authority for immediate suspension.
 *
 * @param client - Connection participating in the caller's transaction.
 * @param actor - Current operator account ID.
 * @param issuerId - Certificate issuer whose hierarchy is locked before authorization.
 * @returns Completion when a TI acts on its own certificate, a TAO on a selected TI,
 * or a RootTAO on any certificate, with the matching current role.
 * @throws IssuanceError for missing hierarchy or organization authority; database errors.
 * @remarks An ordinary status-manager role without an organization grants no emergency power.
 */
export async function lockEmergencyAuthority(client: PoolClient, actor: number, issuerId: string) {
  const { ti } = await lockIssuerChain(client, issuerId);
  const { rowCount } = await client.query(
    `SELECT a.id ${operatorContext}
      WHERE ${activeOperator} AND (
        (r.role = 'plr_rtao' AND owner.kind = 'rtao')
        OR (r.role = 'plr_tao' AND owner.kind = 'tao' AND $2::uuid = owner.id)
        OR (r.role = 'plr_status_manager' AND owner.kind = 'ti' AND $3::uuid = owner.id)
      ) FOR SHARE OF a, r`,
    [actor, ti.parent_id, ti.id],
  );
  if (!rowCount)
    throw new IssuanceError(
      403,
      'NotYours',
      'Only the TI that issued this certificate, the TAO that selected that TI, or the RootTAO suspends it at once.',
    );
}

/**
 * Lock the certificate hierarchy and its operator's registry-wide lifecycle authority.
 *
 * @param client - Connection participating in the caller's transaction.
 * @param actor - Current operator account ID.
 * @param issuerId - Certificate issuer whose hierarchy is locked before the operation.
 * @returns Completion when the active, nonrevoked operator holds the status-manager role.
 * @throws IssuanceError for missing hierarchy, inactive/revoked actor or missing role;
 * database errors.
 * @remarks Proposing and deciding ordinary changes require no TI assignment in the existing
 * product. Transition rules, independent approval and emergency authority are checked separately.
 */
export async function lockStatusManager(client: PoolClient, actor: number, issuerId: string) {
  await lockIssuerChain(client, issuerId);
  const { rowCount } = await client.query(`SELECT a.id ${currentStatusManager} FOR SHARE OF a, r`, [
    actor,
  ]);
  if (!rowCount)
    throw new IssuanceError(403, 'RoleRequired', 'An active status manager role is required.');
}
