import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { lockAdministrationActor } from './administration-lock.ts';
import { readStaffAuthority } from './staff-permissions.ts';
import type { StaffAuthority, StaffUserAction } from './staff-permissions.ts';
import { OperatorManagementError } from './management-error.ts';
import { trimIdentityField } from '../input-text.ts';
import { synchronizeGroupRoles } from './group-roles.ts';
import type {
  StaffGroup,
  StaffGroupOptions,
  StaffGroupPage,
} from '../../../shared/staff-groups.ts';

const projection = `SELECT g.id,g.name,g.version,ARRAY(SELECT permission_id FROM operator_group_permissions
  WHERE group_id=g.id ORDER BY permission_id) AS permission_ids FROM operator_groups g`;

/**
 * Check the existing group-model permission without granting registry authority.
 * @param authority - Live staff identity and direct/inherited permission names.
 * @param action - Group operation to authorize.
 * @returns Whether this staff member may perform the model operation.
 */
function allowed(authority: StaffAuthority | undefined, action: StaffUserAction): boolean {
  return Boolean(
    authority?.isStaff &&
    (authority.isSuperuser ||
      authority.permissions.includes('auth.' + action + '_group') ||
      (action === 'view' && authority.permissions.includes('auth.change_group'))),
  );
}

/**
 * Require current group authority within the caller's transaction.
 * @param client - Transaction query executor.
 * @param actor - Acting account ID.
 * @param action - Required group-model operation.
 * @returns Current authorized staff identity.
 * @throws OperatorManagementError for absent staff/model authority; database errors.
 */
async function authorize(
  client: PoolClient,
  actor: number,
  action: StaffUserAction,
): Promise<StaffAuthority> {
  const authority = await readStaffAuthority(client, actor);
  if (!allowed(authority, action))
    throw new OperatorManagementError(
      403,
      'GroupPermissionRequired',
      'Group model permission is required.',
    );
  return authority!;
}

/**
 * Load one group after authorization without exposing its members' personal data.
 * @param client - Transaction executor.
 * @param id - Positive group identifier.
 * @returns Versioned group or undefined when absent.
 * @throws Database errors.
 */
async function groupView(client: PoolClient, id: number): Promise<StaffGroup | undefined> {
  return (await client.query<StaffGroup>(projection + ' WHERE g.id=$1', [id])).rows[0];
}

/**
 * Build independent group CRUD operations preserving live model permission checks.
 * @param database - Application PostgreSQL pool.
 * @returns Authorized options, paged list, detail, save and remove operations.
 * @remarks Writes share the account administration lock and revoke affected sessions.
 * Non-superusers cannot grant permissions they do not hold or change reserved role names.
 */
export function postgresGroupManagement(database: Pool) {
  return {
    /**
     * Describe current group actions and selectable permission definitions.
     * @param actor - Authenticated staff account.
     * @returns Available actions and permitted grant choices.
     * @throws OperatorManagementError for no group authority; database errors.
     */
    async options(actor: number): Promise<StaffGroupOptions> {
      return transaction(database, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const authority = await readStaffAuthority(client, actor);
        if (
          !(['view', 'add', 'change', 'delete'] as const).some((action) =>
            allowed(authority, action),
          )
        )
          throw new OperatorManagementError(
            403,
            'GroupPermissionRequired',
            'Group model permission is required.',
          );
        const permissions = (
          await client.query<StaffGroupOptions['permissions'][number]>(
            `SELECT id,app_label,codename,name FROM operator_permissions
          WHERE $1::boolean OR app_label||'.'||codename=ANY($2::text[]) ORDER BY app_label,codename`,
            [authority!.isSuperuser, authority!.permissions],
          )
        ).rows;
        return {
          can_view: allowed(authority, 'view'),
          can_add: allowed(authority, 'add'),
          can_change: allowed(authority, 'change'),
          can_delete: allowed(authority, 'delete'),
          permissions,
        };
      });
    },
    /**
     * List a bounded page of groups visible to the current administrator.
     * @param actor - Authenticated staff account.
     * @param query - Optional name search and nonnegative offset.
     * @returns Groups, total count and next offset.
     * @throws OperatorManagementError for no view/change permission; database errors.
     */
    async list(actor: number, query: URLSearchParams): Promise<StaffGroupPage> {
      return transaction(database, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await authorize(client, actor, 'view');
        const raw = Number(query.get('offset') ?? 0);
        const offset = Number.isSafeInteger(raw) && raw >= 0 ? Math.min(raw, 2147483647) : 0;
        const search = trimIdentityField(query.get('q') ?? '')
          .toLowerCase()
          .slice(0, 150);
        const total = (
          await client.query(
            'SELECT count(*)::integer AS count FROM operator_groups WHERE strpos(lower(name),$1)>0',
            [search],
          )
        ).rows[0].count as number;
        const results = (
          await client.query<StaffGroup>(
            projection +
              ' WHERE strpos(lower(g.name),$1)>0 ORDER BY g.name,g.id LIMIT 100 OFFSET $2',
            [search, offset],
          )
        ).rows;
        return {
          results,
          total,
          next: offset + results.length < total ? offset + results.length : null,
        };
      });
    },
    /**
     * Read a group with current grant IDs and optimistic edit version.
     * @param actor - Authenticated staff account.
     * @param id - Selected group ID.
     * @returns Current nonsecret group projection.
     * @throws OperatorManagementError for permission denial or absent group; database errors.
     */
    async read(actor: number, id: number): Promise<StaffGroup> {
      return transaction(database, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const authority = await readStaffAuthority(client, actor);
        if (!allowed(authority, 'view') && !allowed(authority, 'delete'))
          throw new OperatorManagementError(
            403,
            'GroupPermissionRequired',
            'Group viewing or deletion permission is required.',
          );
        const group =
          Number.isInteger(id) && id > 0 && id <= 2147483647
            ? await groupView(client, id)
            : undefined;
        if (!group)
          throw new OperatorManagementError(404, 'UnknownGroup', 'Unknown permission group.');
        return group;
      });
    },
    /**
     * Create, edit or remove a permission group and refresh affected account authority.
     * @param actor - Authenticated staff account.
     * @param input - Explicit name/permission_ids, and group_id/version for an existing row.
     * @param remove - Whether to delete the versioned existing group.
     * @param actorVersion - Session generation observed by HTTP authentication.
     * @returns Committed group, or its ID after deletion.
     * @throws OperatorManagementError for forbidden grants, invalid input, stale versions
     * or name conflicts; database/audit errors roll back every membership and role change.
     */
    async save(
      actor: number,
      input: Record<string, unknown>,
      remove = false,
      actorVersion?: number,
    ): Promise<StaffGroup | { id: number }> {
      return transaction(database, async (client) => {
        await lockAdministrationActor(client, actor, actorVersion);
        const create = input.group_id === undefined;
        const authority = await authorize(
          client,
          actor,
          remove ? 'delete' : create ? 'add' : 'change',
        );
        if (
          (remove && create) ||
          Object.keys(input).some(
            (key) =>
              !(
                remove ? ['group_id', 'version'] : ['group_id', 'version', 'name', 'permission_ids']
              ).includes(key),
          ) ||
          (!create &&
            (!Number.isInteger(input.group_id) ||
              Number(input.group_id) < 1 ||
              Number(input.group_id) > 2147483647 ||
              !Number.isInteger(input.version) ||
              Number(input.version) < 0))
        )
          throw new OperatorManagementError(
            400,
            'InvalidFields',
            'Supply explicit group fields and the current version.',
          );
        if (!create)
          await client.query('SELECT id FROM operator_groups WHERE id=$1 FOR UPDATE', [
            input.group_id,
          ]);
        const current = create ? undefined : await groupView(client, Number(input.group_id));
        if (!create && !current)
          throw new OperatorManagementError(404, 'UnknownGroup', 'Unknown permission group.');
        if (current && current.version !== input.version)
          throw new OperatorManagementError(
            409,
            'GroupChanged',
            'Reload the group before changing it.',
          );
        const name = typeof input.name === 'string' ? trimIdentityField(input.name) : '';
        const permissions = remove ? [] : input.permission_ids;
        if (
          !remove &&
          (!name ||
            name.includes('\0') ||
            Array.from(name).length > 150 ||
            !Array.isArray(permissions) ||
            permissions.length > 10000 ||
            permissions.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
            new Set(permissions).size !== permissions.length)
        )
          throw new OperatorManagementError(
            400,
            'InvalidFields',
            'Supply a group name and distinct permission IDs.',
          );
        const definitions = (
          await client.query<{ id: number; name: string }>(
            `SELECT id,app_label||'.'||codename AS name FROM operator_permissions WHERE id=ANY($1::integer[]) FOR SHARE`,
            [permissions],
          )
        ).rows;
        if (definitions.length !== (permissions as number[]).length)
          throw new OperatorManagementError(
            400,
            'UnknownPrivilege',
            'An assigned permission no longer exists.',
          );
        if (
          !authority.isSuperuser &&
          ((!remove && definitions.some((p) => !authority.permissions.includes(p.name))) ||
            ((create || remove || name !== current?.name) &&
              [name, current?.name ?? ''].some((n) => /^plr_/.test(n))))
        )
          throw new OperatorManagementError(
            403,
            'PrivilegeChangeForbidden',
            'Only a superuser may change registry role groups or grant authority beyond their own.',
          );
        const members = current
          ? (
              await client.query<{ account_id: number }>(
                `SELECT a.id AS account_id FROM operator_accounts a
          JOIN operator_account_groups m ON m.account_id=a.id WHERE m.group_id=$1 ORDER BY a.id FOR UPDATE OF a`,
                [current.id],
              )
            ).rows
          : [];
        let id = current?.id;
        if (remove) await client.query('DELETE FROM operator_groups WHERE id=$1', [id]);
        else {
          if (create)
            id = (
              await client.query<{ id: number }>(
                'INSERT INTO operator_groups(name) VALUES ($1) RETURNING id',
                [name],
              )
            ).rows[0].id;
          else
            await client.query('UPDATE operator_groups SET name=$2,version=version+1 WHERE id=$1', [
              id,
              name,
            ]);
          await client.query('DELETE FROM operator_group_permissions WHERE group_id=$1', [id]);
          await client.query(
            'INSERT INTO operator_group_permissions SELECT $1,unnest($2::integer[])',
            [id, permissions],
          );
        }
        for (const member of members) {
          if (remove || current?.name !== name)
            await synchronizeGroupRoles(client, member.account_id);
          await client.query(
            'UPDATE operator_accounts SET auth_version=auth_version+1 WHERE id=$1',
            [member.account_id],
          );
        }
        await appendAudit(client, {
          event: remove ? 'group.deleted' : create ? 'group.created' : 'group.updated',
          actor,
          detail: remove
            ? { group_id: id }
            : { group_id: id, permissions, ...(create ? {} : { version: current!.version + 1 }) },
        });
        return remove ? { id: id! } : (await groupView(client, id!))!;
      }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === '23505')
          throw new OperatorManagementError(
            409,
            'GroupNameTaken',
            'The group name is already used.',
          );
        throw error;
      });
    },
  };
}
