import type { Pool } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { lockAdministrationActor } from './administration-lock.ts';
import { readStaffAuthority, staffCanManageUser } from './staff-permissions.ts';
import { OperatorManagementError } from './management-error.ts';

/**
 * Delete an authorized, unchanged account while preserving protected domain history.
 * @param database - Application PostgreSQL pool.
 * @param actor - Authenticated staff account requesting deletion.
 * @param input - Target account_id and its expected version, with no other fields.
 * @param actorVersion - Session generation observed before lock acquisition.
 * @returns Deleted account ID; self-deletion also invalidates the acting session.
 * @throws OperatorManagementError for forbidden scope, stale input, protected history
 * or last administrator removal; database/audit errors roll back deletion.
 */
export async function deleteStaffAccount(
  database: Pool,
  actor: number,
  input: Record<string, unknown>,
  actorVersion?: number,
) {
  return transaction(database, async (client) => {
    await lockAdministrationActor(client, actor, actorVersion);
    const authority = await readStaffAuthority(client, actor);
    if (!staffCanManageUser(authority, 'delete', Number(input.account_id)))
      throw new OperatorManagementError(
        403,
        'AdministratorRequired',
        'User deletion permission and scope are required.',
      );
    if (
      Object.keys(input).some((key) => !['account_id', 'version'].includes(key)) ||
      !Number.isInteger(input.account_id) ||
      Number(input.account_id) < 1 ||
      Number(input.account_id) > 2147483647 ||
      !Number.isInteger(input.version) ||
      Number(input.version) < 0
    )
      throw new OperatorManagementError(
        400,
        'InvalidFields',
        'Supply the account ID and current version.',
      );
    const account = (
      await client.query<{
        auth_version: number;
        active: boolean;
        is_staff: boolean;
        is_superuser: boolean;
      }>(
        'SELECT auth_version,active,is_staff,is_superuser FROM operator_accounts WHERE id=$1 FOR UPDATE',
        [input.account_id],
      )
    ).rows[0];
    if (!account)
      throw new OperatorManagementError(404, 'UnknownAccount', 'Unknown operator account.');
    if (account.auth_version !== input.version)
      throw new OperatorManagementError(
        409,
        'AccountChanged',
        'Reload the account before deleting it.',
      );
    const protectedHistory = (
      await client.query(
        `SELECT EXISTS (
      SELECT 1 FROM audit_entries WHERE actor_id=$1
    ) AS protected`,
        [input.account_id],
      )
    ).rows[0].protected;
    if (protectedHistory)
      throw new OperatorManagementError(
        409,
        'ProtectedAccount',
        'This account is referenced by protected history.',
      );
    if (
      account.active &&
      account.is_staff &&
      account.is_superuser &&
      !(
        await client.query(
          `
      SELECT 1 FROM operator_accounts a WHERE a.id<>$1 AND a.active AND
        ((a.is_staff AND a.is_superuser) OR EXISTS (SELECT 1 FROM operator_roles r WHERE r.account_id=a.id AND r.role='plr_admin'))
        AND NOT EXISTS (SELECT 1 FROM accredited_organizations o
          LEFT JOIN accredited_organizations p ON p.id=o.parent_id LEFT JOIN accredited_organizations root ON root.id=p.parent_id
          WHERE o.account_id=a.id AND LEAST(o.revoked_at,p.revoked_at,root.revoked_at)<=statement_timestamp()) LIMIT 1`,
          [input.account_id],
        )
      ).rowCount
    )
      throw new OperatorManagementError(
        409,
        'LastAdministrator',
        'Keep at least one active administrator.',
      );
    // Native platform administrators use a separate editor; never delete that grant through staff scope.
    if (
      (
        await client.query(
          "SELECT 1 FROM operator_roles WHERE account_id=$1 AND role='plr_admin'",
          [input.account_id],
        )
      ).rowCount
    )
      throw new OperatorManagementError(
        409,
        'ProtectedAccount',
        'Remove the platform administrator grant before deleting the account.',
      );
    await appendAudit(client, {
      event: 'account.deleted',
      actor,
      detail: { account_id: input.account_id },
    });
    await client.query('DELETE FROM operator_accounts WHERE id=$1', [input.account_id]);
    return { account_id: Number(input.account_id) };
  }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === '23503')
      throw new OperatorManagementError(
        409,
        'ProtectedAccount',
        'This account is referenced by protected domain records.',
      );
    throw error;
  });
}
