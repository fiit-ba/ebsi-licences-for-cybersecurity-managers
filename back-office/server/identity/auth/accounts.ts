import type { Pool } from 'pg';
import type { OrganizationKind } from '../../accreditation/types.ts';

/** Account row with the live role and organization context used by authentication. */
export interface OperatorAccount {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  auth_version: number;
  roles: string[];
  governance_roles?: string[];
  organization_name: string | null;
  organization_kind: OrganizationKind | null;
  organization_did: string | null;
  accredited_until: Date | null;
  accreditation_ended: boolean;
  revoked_name: string | null;
  revoked_kind: OrganizationKind | null;
  revoked_at: Date | null;
}
/**
 * Create account lookups that include current roles and inherited revocation.
 *
 * @param database - PostgreSQL query executor.
 * @returns Username and ID lookups returning an account row or undefined.
 */
export function postgresAccounts(database: Pick<Pool, 'query'>) {
  /**
   * Load an account and the nearest revoked ancestor in one statement.
   *
   * @param field - Internal, fixed account column name.
   * @param value - Username or account ID to match.
   * @returns The account with roles and organization context, or undefined.
   * @throws Database errors if a query, lock or commit fails.
   */
  async function find(
    field: 'username' | 'id',
    value: string | number,
  ): Promise<OperatorAccount | undefined> {
    const { rows } = await database.query<OperatorAccount>(
      `
      SELECT a.*, ARRAY(
        SELECT r.role FROM operator_roles r WHERE r.account_id = a.id ORDER BY r.role
      ) AS roles,
      ARRAY(
        SELECT g.role FROM operator_governance_roles g WHERE g.account_id = a.id ORDER BY g.role
      ) AS governance_roles,
      org.name AS organization_name,
      org.kind AS organization_kind,
      org.did AS organization_did,
      org.accredited_until,
      COALESCE(org.accredited_until <= statement_timestamp(), false)
        OR revoked.revoked_at IS NOT NULL AS accreditation_ended,
      revoked.name AS revoked_name,
      revoked.kind AS revoked_kind,
      revoked.revoked_at
      FROM operator_accounts a
      LEFT JOIN accredited_organizations org ON org.account_id = a.id
      LEFT JOIN accredited_organizations parent ON parent.id = org.parent_id
      LEFT JOIN accredited_organizations root ON root.id = parent.parent_id
      LEFT JOIN LATERAL (
        SELECT ancestor.name, ancestor.kind, ancestor.revoked_at
        FROM (VALUES
          (1, org.name, org.kind, org.revoked_at),
          (2, parent.name, parent.kind, parent.revoked_at),
          (3, root.name, root.kind, root.revoked_at)
        ) AS ancestor(depth, name, kind, revoked_at)
        WHERE ancestor.revoked_at <= statement_timestamp()
        ORDER BY ancestor.depth
        LIMIT 1
      ) revoked ON true
      WHERE a.${field} = $1
    `,
      [value],
    );
    return rows[0];
  }

  return {
    /**
     * Find an operator by exact username.
     *
     * @param username - Username to match.
     * @returns The current account and authority snapshot, or undefined.
     * @throws Database errors if a query, lock or commit fails.
     */
    byUsername: (username: string) => find('username', username),
    /**
     * Find an operator by account ID.
     *
     * @param id - Account ID to match.
     * @returns The current account and authority snapshot, or undefined.
     * @throws Database errors if a query, lock or commit fails.
     */
    byId: (id: number) => find('id', id),
  };
}
