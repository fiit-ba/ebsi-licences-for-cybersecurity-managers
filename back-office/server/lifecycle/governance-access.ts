import type { PoolClient } from 'pg';
import { IssuanceError } from '../issuance/claims.ts';

/**
 * Revalidate an explicit signer membership independently of business/operator roles.
 * @param client - Caller-owned transaction connection.
 * @param actor - Current authenticated account ID.
 * @param role - Requested role letter.
 * @param permitted - Deployment console role allowlist, restricted to held body keys.
 * @returns Completion after locking the live account and exact signer membership.
 * @throws IssuanceError for absent/deactivated/revoked authority or a disallowed role; DB errors.
 */
export async function authorizeGovernance(
  client: PoolClient,
  actor: number,
  role: string,
  permitted: readonly string[],
) {
  if (!permitted.includes(role))
    throw new IssuanceError(
      403,
      'RoleNotPermitted',
      `Role ${role} cannot be used from this console.`,
    );
  // Match organization revocation's root-to-leaf order and keep it stable until
  // the signature transaction ends, rather than checking only a stale snapshot.
  const hierarchy = (
    await client.query<{ id: string }>(
      `
    WITH RECURSIVE path AS (
      SELECT id,parent_id,0 AS depth FROM accredited_organizations WHERE account_id=$1
      UNION ALL SELECT parent.id,parent.parent_id,path.depth+1 FROM accredited_organizations parent
      JOIN path ON parent.id=path.parent_id
    ) SELECT id FROM path ORDER BY depth DESC,id`,
      [actor],
    )
  ).rows;
  for (const organization of hierarchy)
    await client.query('SELECT id FROM accredited_organizations WHERE id=$1 FOR SHARE', [
      organization.id,
    ]);
  const { rowCount } = await client.query(
    `SELECT a.id FROM operator_accounts a JOIN operator_governance_roles r ON r.account_id=a.id
    WHERE a.id=$1 AND a.active AND r.role=$2 AND NOT EXISTS (
      SELECT 1 FROM accredited_organizations o LEFT JOIN accredited_organizations p ON p.id=o.parent_id
      LEFT JOIN accredited_organizations root ON root.id=p.parent_id WHERE o.account_id=a.id
      AND LEAST(o.revoked_at,p.revoked_at,root.revoked_at)<=statement_timestamp()) FOR SHARE OF a,r`,
    [actor, role],
  );
  if (!rowCount)
    throw new IssuanceError(
      403,
      'RoleNotAssigned',
      `You have not been assigned role ${role} (group plr_governance_${role.toLowerCase()}).`,
    );
}
