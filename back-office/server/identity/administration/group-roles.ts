import type { PoolClient } from 'pg';

/** Registry memberships derived exclusively from their corresponding named groups. */
export const registryGroupNames = [
  'plr_issuer',
  'plr_status_manager',
  'plr_verifier',
  'plr_auditor',
  'plr_tao',
  'plr_rtao',
] as const;

/**
 * Refresh business and signer roles after an explicit group membership/name change.
 * @param client - Caller-owned administration transaction holding the account lock.
 * @param account - Account whose complete current memberships should be projected.
 * @returns Completion after role projection; the separate native administrator grant survives.
 * @throws Database errors; callers must roll back the whole administration operation.
 */
export async function synchronizeGroupRoles(client: PoolClient, account: number): Promise<void> {
  const names = (
    await client.query<{ name: string }>(
      `SELECT g.name FROM operator_groups g
    JOIN operator_account_groups m ON m.group_id=g.id WHERE m.account_id=$1`,
      [account],
    )
  ).rows.map((g) => g.name);
  await client.query("DELETE FROM operator_roles WHERE account_id=$1 AND role <> 'plr_admin'", [
    account,
  ]);
  await client.query(
    'INSERT INTO operator_roles SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING',
    [account, registryGroupNames.filter((name) => names.includes(name))],
  );
  await client.query('DELETE FROM operator_governance_roles WHERE account_id=$1', [account]);
  await client.query('INSERT INTO operator_governance_roles SELECT $1,unnest($2::text[])', [
    account,
    ['A', 'B', 'C'].filter((role) => names.includes('plr_governance_' + role.toLowerCase())),
  ]);
}
