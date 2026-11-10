import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { lockAdministrationActor } from './administration-lock.ts';
import { OperatorManagementError } from './management-error.ts';
import { readStaffAuthority, staffCanManageUser } from './staff-permissions.ts';
import { staffAccountInput } from './staff-account-input.ts';
import { hashPassword } from '../auth/passwords.ts';
import type { StaffAccount, StaffAccountOptions } from '../../../shared/staff-accounts.ts';
import { synchronizeGroupRoles } from './group-roles.ts';
import { deleteStaffAccount } from './account-deletion.ts';
import type { AccountCreatedHook } from '../recovery/recovery-types.ts';

const projection = `SELECT a.id,a.username,a.email,a.first_name,a.last_name,a.active,a.is_staff,a.is_superuser,
  a.auth_version AS version,
  to_char(a.date_joined AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_joined,
  to_char(a.last_login AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_login,
  ARRAY(SELECT group_id FROM operator_account_groups WHERE account_id=a.id ORDER BY group_id) AS group_ids,
  ARRAY(SELECT permission_id FROM operator_account_permissions WHERE account_id=a.id ORDER BY permission_id) AS permission_ids
  FROM operator_accounts a`;
const fullAdministrator = `a.active AND ((a.is_staff AND a.is_superuser) OR EXISTS (
  SELECT 1 FROM operator_roles role WHERE role.account_id=a.id AND role.role='plr_admin'
)) AND NOT EXISTS (
  SELECT 1 FROM accredited_organizations o LEFT JOIN accredited_organizations p ON p.id=o.parent_id
  LEFT JOIN accredited_organizations root ON root.id=p.parent_id WHERE o.account_id=a.id
    AND LEAST(o.revoked_at,p.revoked_at,root.revoked_at) <= statement_timestamp()
)`;

/**
 * Load the nonsecret full account fields for an authorized administration operation.
 * @param client - Transaction query executor.
 * @param target - Account ID already checked against the acting user's scope.
 * @returns Current account projection, or undefined if it does not exist.
 * @throws Database errors.
 */
async function accountView(client: PoolClient, target: number): Promise<StaffAccount | undefined> {
  return (await client.query<StaffAccount>(projection + ' WHERE a.id=$1', [target])).rows[0];
}

/**
 * Compare a sorted current grant list with its validated replacement.
 * @param current - Stored ascending IDs.
 * @param proposed - Validated ascending IDs.
 * @returns Whether the effective grant list is unchanged.
 */
function sameIds(current: readonly number[], proposed: readonly number[]): boolean {
  return current.length === proposed.length && current.every((id, index) => id === proposed[index]);
}

/**
 * Build current staff account operations retaining explicit model permissions and self scope.
 * @param database - Application PostgreSQL pool.
 * @param accountCreated - Optional activation enqueue operation sharing the account transaction.
 * @returns Options, detail, create and update operations; no action grants business roles implicitly.
 * @remarks Supported administrative writes share an advisory lock. Staff editors
 * may change their own personal data but cannot promote their flags or grants.
 */
export function postgresStaffManagement(database: Pool, accountCreated?: AccountCreatedHook) {
  return {
    /**
     * Remove an unchanged account subject to live scope and history protection.
     * @param actor - Authenticated staff account.
     * @param input - Target account_id and expected version.
     * @param actorVersion - Authenticated session generation.
     * @returns Deleted account ID.
     * @throws OperatorManagementError for permission, history or version refusal; database errors.
     */
    remove: (actor: number, input: Record<string, unknown>, actorVersion?: number) =>
      deleteStaffAccount(database, actor, input, actorVersion),
    /**
     * Describe currently authorized user-model actions and visible grant choices.
     * @param actor - Acting account ID from a validated session.
     * @returns Live scope, action permissions and authorized group/permission labels.
     * @throws OperatorManagementError for missing staff/model authority; database errors.
     */
    async options(actor: number): Promise<StaffAccountOptions> {
      return transaction(database, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const authority = await readStaffAuthority(client, actor);
        if (
          !authority?.isStaff ||
          !(['view', 'add', 'change', 'delete'] as const).some((action) =>
            staffCanManageUser(authority, action),
          )
        )
          throw new OperatorManagementError(
            403,
            'AdministratorRequired',
            'Staff model permission is required.',
          );
        const all = authority.isSuperuser;
        return {
          actor_id: actor,
          scope: all ? 'all' : 'self',
          can_view: staffCanManageUser(authority, 'view'),
          can_add: staffCanManageUser(authority, 'add'),
          can_change: staffCanManageUser(authority, 'change'),
          can_delete: staffCanManageUser(authority, 'delete'),
          can_manage_privileges: all,
          groups: (
            await client.query<{ id: number; name: string }>(
              `SELECT id,name FROM operator_groups g
            WHERE $1::boolean OR EXISTS (SELECT 1 FROM operator_account_groups m WHERE m.account_id=$2 AND m.group_id=g.id)
            ORDER BY name`,
              [all, actor],
            )
          ).rows,
          permissions: (
            await client.query<{ id: number; name: string; app_label: string; codename: string }>(
              `SELECT id,name,app_label,codename
            FROM operator_permissions p WHERE $1::boolean OR EXISTS (
              SELECT 1 FROM operator_account_permissions own WHERE own.account_id=$2 AND own.permission_id=p.id)
            ORDER BY app_label,codename`,
              [all, actor],
            )
          ).rows,
        };
      });
    },

    /**
     * Read one account within the current administrator’s permitted scope.
     * @param actor - Acting account ID.
     * @param target - Account ID selected by the administration route.
     * @returns Account fields without its password hash.
     * @throws OperatorManagementError for forbidden scope or a missing row; database errors.
     */
    async read(actor: number, target: number): Promise<StaffAccount> {
      if (!Number.isInteger(target) || target < 1 || target > 2147483647)
        throw new OperatorManagementError(400, 'InvalidFields', 'Supply a valid account ID.');
      return transaction(database, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const authority = await readStaffAuthority(client, actor);
        if (
          !staffCanManageUser(authority, 'view', target) &&
          !staffCanManageUser(authority, 'delete', target)
        )
          throw new OperatorManagementError(
            403,
            'AdministratorRequired',
            'User viewing permission is required.',
          );
        const account = await accountView(client, target);
        if (!account)
          throw new OperatorManagementError(404, 'UnknownAccount', 'Unknown operator account.');
        return account;
      });
    },

    /**
     * Create or update an account with model permission, scope and privilege-change checks.
     * @param actor - Acting staff account ID.
     * @param input - Personal fields, optional grant replacements and current edit version.
     * @param actorVersion - Session generation authenticated before waiting for locks.
     * @returns Committed nonsecret account fields.
     * @throws OperatorManagementError for permission/scope failures, weak input,
     * promotion attempts, stale versions, unknown grants or last-admin removal;
     * database, crypto and audit errors roll back all account/grant changes.
     */
    async save(
      actor: number,
      input: Record<string, unknown>,
      actorVersion?: number,
    ): Promise<StaffAccount> {
      const create = input.account_id === undefined;
      return transaction(database, async (client) => {
        await lockAdministrationActor(client, actor, actorVersion);
        const authority = await readStaffAuthority(client, actor);
        const target = create ? undefined : Number(input.account_id);
        if (!staffCanManageUser(authority, create ? 'add' : 'change', target))
          throw new OperatorManagementError(
            403,
            'AdministratorRequired',
            'User editing permission and scope are required.',
          );
        if (
          !create &&
          (!Number.isInteger(input.account_id) ||
            Number(input.account_id) < 1 ||
            Number(input.account_id) > 2147483647 ||
            !Number.isInteger(input.version) ||
            Number(input.version) < 0)
        )
          throw new OperatorManagementError(
            400,
            'InvalidFields',
            'Updates require account ID and edit version.',
          );
        if (target !== undefined)
          await client.query('SELECT id FROM operator_accounts WHERE id=$1 FOR UPDATE', [target]);
        const current = target === undefined ? undefined : await accountView(client, target);
        if (target !== undefined && !current)
          throw new OperatorManagementError(404, 'UnknownAccount', 'Unknown operator account.');
        if (current && current.version !== input.version)
          throw new OperatorManagementError(
            409,
            'AccountChanged',
            'The account changed; reload it before saving.',
          );
        const value = staffAccountInput(input, current);
        if (
          !authority!.isSuperuser &&
          (value.is_staff !== (current?.is_staff ?? false) ||
            value.is_superuser !== (current?.is_superuser ?? false) ||
            !sameIds(current?.group_ids ?? [], value.group_ids) ||
            !sameIds(current?.permission_ids ?? [], value.permission_ids))
        )
          throw new OperatorManagementError(
            403,
            'PrivilegeChangeForbidden',
            'Staff cannot change their own privileges or create privileged accounts.',
          );
        const groups = (
          await client.query<{ id: number; name: string }>(
            'SELECT id,name FROM operator_groups WHERE id=ANY($1::integer[]) FOR SHARE',
            [value.group_ids],
          )
        ).rows;
        const permissions = await client.query(
          'SELECT id FROM operator_permissions WHERE id=ANY($1::integer[]) FOR SHARE',
          [value.permission_ids],
        );
        if (
          groups.length !== value.group_ids.length ||
          permissions.rowCount !== value.permission_ids.length
        )
          throw new OperatorManagementError(
            400,
            'UnknownPrivilege',
            'An assigned group or permission no longer exists.',
          );
        const hadAdministrator = Boolean(
          (
            await client.query(
              `SELECT a.id FROM operator_accounts a WHERE ${fullAdministrator} LIMIT 1`,
            )
          ).rowCount,
        );
        const password = value.password === undefined ? null : await hashPassword(value.password);
        let id = target;
        if (create) {
          id = (
            await client.query<{ id: number }>(
              `INSERT INTO operator_accounts(username,email,password_hash,first_name,last_name,active,is_staff,is_superuser)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
              [
                value.username,
                value.email,
                password,
                value.first_name,
                value.last_name,
                value.active,
                value.is_staff,
                value.is_superuser,
              ],
            )
          ).rows[0].id;
        } else {
          await client.query(
            `UPDATE operator_accounts SET username=$2,email=$3,first_name=$4,last_name=$5,active=$6,
            is_staff=$7,is_superuser=$8,password_hash=COALESCE($9,password_hash),auth_version=auth_version+1 WHERE id=$1`,
            [
              id,
              value.username,
              value.email,
              value.first_name,
              value.last_name,
              value.active,
              value.is_staff,
              value.is_superuser,
              password,
            ],
          );
        }
        if (create || !sameIds(current!.group_ids, value.group_ids)) {
          await client.query('DELETE FROM operator_account_groups WHERE account_id=$1', [id]);
          await client.query(
            'INSERT INTO operator_account_groups SELECT $1,unnest($2::integer[])',
            [id, value.group_ids],
          );
          await synchronizeGroupRoles(client, id!);
        }
        await client.query('DELETE FROM operator_account_permissions WHERE account_id=$1', [id]);
        await client.query(
          'INSERT INTO operator_account_permissions SELECT $1,unnest($2::integer[])',
          [id, value.permission_ids],
        );
        if (
          hadAdministrator &&
          !(
            await client.query(
              `SELECT a.id FROM operator_accounts a WHERE ${fullAdministrator} LIMIT 1`,
            )
          ).rowCount
        )
          throw new OperatorManagementError(
            409,
            'LastAdministrator',
            'Keep at least one active administrator.',
          );
        if (create && accountCreated) await accountCreated(client, id!);
        await appendAudit(client, {
          event: create ? 'account.created' : 'account.updated',
          actor,
          detail: {
            account_id: id,
            active: value.active,
            version: (current?.version ?? -1) + 1,
            staff: value.is_staff,
            superuser: value.is_superuser,
            groups: value.group_ids,
            permissions: value.permission_ids,
          },
        });
        if (!create && password !== null)
          await appendAudit(client, {
            event: 'account.password_reset',
            actor,
            detail: { account_id: id },
          });
        return (await accountView(client, id!))!;
      }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === '23505')
          throw new OperatorManagementError(409, 'UsernameTaken', 'The username is already used.');
        throw error;
      });
    },
  };
}
