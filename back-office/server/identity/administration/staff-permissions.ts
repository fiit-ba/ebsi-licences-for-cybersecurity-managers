import type { PoolClient } from 'pg';

/** Live administration authority, separate from registry and ledger signer roles. */
export interface StaffAuthority {
  id: number;
  isStaff: boolean;
  isSuperuser: boolean;
  permissions: readonly string[];
}

/** Administration operations requiring their corresponding administration permission. */
export type StaffUserAction = 'view' | 'add' | 'change' | 'delete';

/** Fields and effective permissions projected by one PostgreSQL statement. */
interface StaffAuthorityRow {
  id: number;
  is_staff: boolean;
  is_superuser: boolean;
  permissions: string[];
}

/**
 * Load active staff authority and exact direct/inherited permissions from live state.
 * @param client - Query executor in the caller's transaction or consistent snapshot.
 * @param actor - Account identifier from a validated session.
 * @returns Current authority, or undefined for an inactive or revoked account.
 * @throws Database errors.
 * @remarks Superuser status affects administration only; business and governance
 * authorization continue to require their explicit role memberships.
 */
export async function readStaffAuthority(
  client: Pick<PoolClient, 'query'>,
  actor: number,
): Promise<StaffAuthority | undefined> {
  const row = (
    await client.query<StaffAuthorityRow>(
      `
    SELECT a.id, a.is_staff, a.is_superuser, ARRAY(
      SELECT p.app_label || '.' || p.codename FROM operator_permissions p
      WHERE EXISTS (SELECT 1 FROM operator_account_permissions own WHERE own.account_id=a.id AND own.permission_id=p.id)
        OR EXISTS (SELECT 1 FROM operator_account_groups member
          JOIN operator_group_permissions inherited ON inherited.group_id=member.group_id
          WHERE member.account_id=a.id AND inherited.permission_id=p.id)
      ORDER BY p.app_label, p.codename
    ) AS permissions
    FROM operator_accounts a WHERE a.id=$1 AND a.active AND NOT EXISTS (
      SELECT 1 FROM accredited_organizations o
      LEFT JOIN accredited_organizations parent ON parent.id=o.parent_id
      LEFT JOIN accredited_organizations root ON root.id=parent.parent_id
      WHERE o.account_id=a.id
        AND LEAST(o.revoked_at,parent.revoked_at,root.revoked_at) <= statement_timestamp()
    )
  `,
      [actor],
    )
  ).rows[0];
  return (
    row && {
      id: row.id,
      isStaff: row.is_staff,
      isSuperuser: row.is_superuser,
      permissions: [...new Set(row.permissions)],
    }
  );
}

/**
 * Apply account administration permissions and self-only access rules.
 * @param authority - Live authority read in the caller's transaction.
 * @param action - User-model operation being authorized.
 * @param target - Existing account ID; omitted for collection/create checks.
 * @returns Whether this exact action and target are within the actor's authority.
 * @remarks Non-superuser staff may view/change/delete only their own queryset row.
 * A change permission also permits viewing, preserving the administration permission hierarchy.
 */
export function staffCanManageUser(
  authority: StaffAuthority | undefined,
  action: StaffUserAction,
  target?: number,
): boolean {
  if (!authority?.isStaff) return false;
  if (!authority.isSuperuser && target !== undefined && target !== authority.id) return false;
  if (authority.isSuperuser) return true;
  return (
    authority.permissions.includes(`auth.${action}_user`) ||
    (action === 'view' && authority.permissions.includes('auth.change_user'))
  );
}
