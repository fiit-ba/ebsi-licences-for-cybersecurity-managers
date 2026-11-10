import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { hashPassword } from '../auth/passwords.ts';
import { OperatorManagementError } from './management-error.ts';
import { operatorCredentials } from './operator-credentials.ts';
import { lockAdministrationActor } from './administration-lock.ts';
import { postgresStaffManagement } from './staff-management.ts';
import { postgresGroupManagement } from './group-management.ts';
import type { AccountCreatedHook } from '../recovery/recovery-types.ts';
import { changeStaffPassword } from './password-change.ts';
import { readStaffAuthority, staffCanManageUser } from './staff-permissions.ts';
import { operatorRoles } from '../../../shared/operator-accounts.ts';
import type {
  ManagedOperator,
  OperatorRole,
  OperatorPage,
} from '../../../shared/operator-accounts.ts';

const administrator = `a.active AND EXISTS (
  SELECT 1 FROM operator_roles r WHERE r.account_id = a.id AND r.role = 'plr_admin'
) AND NOT EXISTS (
  SELECT 1 FROM accredited_organizations o
  LEFT JOIN accredited_organizations p ON p.id = o.parent_id
  LEFT JOIN accredited_organizations root ON root.id = p.parent_id
  WHERE o.account_id = a.id AND LEAST(o.revoked_at, p.revoked_at, root.revoked_at) <= statement_timestamp()
)`;
const projection = `
  SELECT a.id, a.username, a.email, a.active, a.auth_version AS version,
    ARRAY(SELECT role FROM operator_roles WHERE account_id = a.id ORDER BY role) AS roles,
    CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'organization_id', o.id, 'name', o.name, 'kind', o.kind,
      'revoked', COALESCE(LEAST(o.revoked_at,p.revoked_at,root.revoked_at) <= statement_timestamp(), false)
    ) END AS organization
  FROM operator_accounts a
  LEFT JOIN accredited_organizations o ON o.account_id = a.id
  LEFT JOIN accredited_organizations p ON p.id = o.parent_id
  LEFT JOIN accredited_organizations root ON root.id = p.parent_id
`;

/** Normalized account edit fields accepted by the administration service. */
interface AccountInput {
  username: string;
  email: string;
  active: boolean;
  roles: OperatorRole[];
  password?: string;
}

/**
 * Normalize the complete requested account state and reject unknown privilege names.
 * @param input - Untrusted account fields and roles.
 * @param create - Whether the operation creates a new account.
 * @returns The validated full account edit.
 * @throws OperatorManagementError for invalid fields, roles or obsolete issuer assignments.
 */
function accountInput(input: Record<string, unknown>, create: boolean): AccountInput {
  const credentials = operatorCredentials(input, create);
  if (
    !Array.isArray(input.roles) ||
    input.roles.some((role) => !operatorRoles.includes(role as OperatorRole)) ||
    typeof input.active !== 'boolean' ||
    input.status_issuer_ids !== undefined
  ) {
    throw new OperatorManagementError(
      400,
      'InvalidFields',
      'Supply known roles and active state; TI status-manager assignments are not supported.',
    );
  }
  const roles = [...new Set(input.roles as OperatorRole[])].sort();
  return { ...credentials, roles, active: input.active };
}

/**
 * Require a current active administrator, optionally retaining its account/role locks.
 * @param client - Transaction connection.
 * @param actor - Acting account ID.
 * @param lock - Whether to hold authority stable until transaction end.
 * @returns Completion when administration is authorized.
 * @throws OperatorManagementError for missing authority; database errors.
 */
export async function authorizeAdministrator(client: PoolClient, actor: number, lock = false) {
  const { rowCount } = await client.query(
    `
    SELECT a.id FROM operator_accounts a JOIN operator_roles guard ON guard.account_id = a.id AND guard.role = 'plr_admin'
    WHERE a.id = $1 AND ${administrator} ${lock ? 'FOR SHARE OF a, guard' : ''}
  `,
    [actor],
  );
  if (!rowCount)
    throw new OperatorManagementError(
      403,
      'AdministratorRequired',
      'An active administrator is required.',
    );
}

/**
 * Parse a bounded account page offset.
 * @param query - Request query parameters.
 * @returns A nonnegative safe offset, defaulting to zero.
 */
function pageOffset(query: URLSearchParams) {
  const raw = query.get('offset');
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) ? Math.min(Number.MAX_SAFE_INTEGER - 101, value) : 0;
}

/**
 * Load a public account projection after a committed-in-transaction edit.
 * @param client - Transaction connection.
 * @param id - Account ID.
 * @returns The account without password material.
 * @throws Database errors if projection cannot be read.
 */
async function accountView(client: PoolClient, id: number): Promise<ManagedOperator> {
  return (await client.query<ManagedOperator>(projection + ' WHERE a.id = $1', [id])).rows[0];
}

/**
 * Replace roles without allowing fabricated hierarchy roles.
 * @param client - Transaction connection.
 * @param id - Target account ID.
 * @param input - Validated replacement roles.
 * @returns Completion after the replacement is stored.
 * @throws OperatorManagementError for hierarchy-role mismatch; database errors.
 */
async function replacePrivileges(client: PoolClient, id: number, input: AccountInput) {
  const {
    rows: [organization],
  } = await client.query('SELECT kind FROM accredited_organizations WHERE account_id = $1', [id]);
  if (input.roles.includes('plr_admin') && organization && organization.kind !== 'rtao') {
    throw new OperatorManagementError(
      400,
      'AdministratorOrganizationMismatch',
      'Use a standalone account or RootTAO account for platform administration.',
    );
  }
  for (const kind of ['rtao', 'tao'] as const) {
    if (input.roles.includes(`plr_${kind}`) && organization?.kind !== kind) {
      throw new OperatorManagementError(
        400,
        'OrganizationRoleMismatch',
        'Hierarchy roles require the corresponding registered organization.',
      );
    }
  }
  await client.query('DELETE FROM operator_roles WHERE account_id = $1', [id]);
  await client.query('INSERT INTO operator_roles SELECT $1, unnest($2::text[])', [id, input.roles]);
}

/**
 * Create account administration with serialized authority and last-admin checks.
 * @param database - PostgreSQL pool.
 * @param accountCreated - Optional durable activation enqueue hook, sharing the account transaction.
 * @returns Account listing and full-state create/update operations.
 * @remarks The advisory lock serializes administrative edits, including self-demotion races.
 */
export function postgresOperatorManagement(database: Pool, accountCreated?: AccountCreatedHook) {
  return {
    staff: postgresStaffManagement(database, accountCreated),
    groups: postgresGroupManagement(database),
    /**
     * Replace the acting staff member's own password after current-password verification.
     * @param actor - Authenticated staff account.
     * @param input - Current and matching new passwords.
     * @param version - Authenticated session generation.
     * @returns Acknowledgement after invalidating old sessions and reset links.
     * @throws OperatorManagementError for input/authority refusal; database/crypto errors.
     */
    changePassword: (actor: number, input: Record<string, unknown>, version?: number) =>
      changeStaffPassword(database, actor, input, version),
    /**
     * List a bounded account page from one authorized snapshot.
     * @param actor - Administrator or explicitly permitted staff account ID.
     * @param query - Optional username/email search and offset.
     * @returns Account rows, total count and next offset.
     * @throws OperatorManagementError for missing authority; database errors.
     */
    async list(actor: number, query: URLSearchParams): Promise<OperatorPage> {
      return transaction(database, async (client: PoolClient) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const platformAdministrator = Boolean(
          (
            await client.query(
              `SELECT a.id FROM operator_accounts a WHERE a.id=$1 AND ${administrator}`,
              [actor],
            )
          ).rowCount,
        );
        const staff = await readStaffAuthority(client, actor);
        if (!platformAdministrator && !staffCanManageUser(staff, 'view'))
          throw new OperatorManagementError(
            403,
            'AdministratorRequired',
            'User administration permission is required.',
          );
        const allAccounts = platformAdministrator || staff?.isSuperuser === true;
        const offset = pageOffset(query);
        const search = query.get('q')?.trim().toLowerCase().slice(0, 150) ?? '';
        const where =
          ' WHERE (strpos(lower(a.username), $1) > 0 OR strpos(lower(a.email), $1) > 0) AND ($2::boolean OR a.id=$3)';
        const total = (
          await client.query<{ count: number }>(
            'SELECT count(*)::integer AS count FROM operator_accounts a' + where,
            [search, allAccounts, actor],
          )
        ).rows[0].count;
        const rows = (
          await client.query<ManagedOperator>(
            projection + where + ' ORDER BY a.id LIMIT 100 OFFSET $4',
            [search, allAccounts, actor, offset],
          )
        ).rows;
        return {
          results: rows,
          total,
          next: offset + rows.length < total ? offset + rows.length : null,
        };
      });
    },
    /**
     * Create or update an operator with optimistic edit and session-generation checks.
     * @param actor - Administrator account ID.
     * @param input - Complete account fields; updates require account_id and expected version.
     * @param actorVersion - Session generation authenticated before waiting for locks.
     * @returns The saved public account projection.
     * @throws OperatorManagementError for invalid/conflicting edits or loss of the last administrator;
     * database, audit and password-hashing errors.
     */
    async save(
      actor: number,
      input: Record<string, unknown>,
      actorVersion?: number,
    ): Promise<ManagedOperator> {
      const create = input.account_id === undefined;
      const value = accountInput(input, create);
      if (
        !create &&
        (!Number.isInteger(input.account_id) ||
          Number(input.account_id) < 1 ||
          Number(input.account_id) > 2147483647 ||
          !Number.isInteger(input.version) ||
          Number(input.version) < 0)
      ) {
        throw new OperatorManagementError(
          400,
          'InvalidFields',
          'Updates require an account ID and edit version.',
        );
      }
      const password =
        value.password === undefined ? undefined : await hashPassword(value.password);
      return transaction(database, async (client: PoolClient) => {
        await lockAdministrationActor(client, actor, actorVersion);
        await authorizeAdministrator(client, actor, true);
        let id: number;
        if (create) {
          const row = (
            await client.query<{ id: number }>(
              `
            INSERT INTO operator_accounts (username,email,password_hash,active) VALUES ($1,$2,$3,$4)
            ON CONFLICT (username) DO NOTHING RETURNING id
          `,
              [value.username, value.email, password, value.active],
            )
          ).rows[0];
          if (!row)
            throw new OperatorManagementError(
              409,
              'UsernameTaken',
              'The username is already used.',
            );
          id = row.id;
        } else {
          id = Number(input.account_id);
          const current = (
            await client.query<{ auth_version: number }>(
              'SELECT auth_version FROM operator_accounts WHERE id = $1 FOR UPDATE',
              [id],
            )
          ).rows[0];
          if (!current)
            throw new OperatorManagementError(404, 'UnknownAccount', 'Unknown operator account.');
          if (current.auth_version !== input.version)
            throw new OperatorManagementError(
              409,
              'AccountChanged',
              'The account changed; reload it before saving.',
            );
          const duplicate = (
            await client.query('SELECT 1 FROM operator_accounts WHERE username = $1 AND id <> $2', [
              value.username,
              id,
            ])
          ).rowCount;
          if (duplicate)
            throw new OperatorManagementError(
              409,
              'UsernameTaken',
              'The username is already used.',
            );
          await client.query(
            `
            UPDATE operator_accounts SET username = $2, email = $3, active = $4,
              password_hash = COALESCE($5, password_hash), auth_version = auth_version + 1 WHERE id = $1
          `,
            [id, value.username, value.email, value.active, password],
          );
        }
        await replacePrivileges(client, id, value);
        const { rowCount } = await client.query(
          `SELECT a.id FROM operator_accounts a WHERE ${administrator} LIMIT 1`,
        );
        if (!rowCount)
          throw new OperatorManagementError(
            409,
            'LastAdministrator',
            'Keep at least one active administrator.',
          );
        const saved = await accountView(client, id);
        if (create && accountCreated) await accountCreated(client, id);
        await appendAudit(client, {
          event: create ? 'account.created' : 'account.updated',
          actor,
          detail: {
            account_id: id,
            roles: saved.roles,
            active: saved.active,
            version: saved.version,
          },
        });
        if (!create && password !== undefined)
          await appendAudit(client, {
            event: 'account.password_reset',
            actor,
            detail: { account_id: id },
          });
        return saved;
      }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          throw new OperatorManagementError(409, 'UsernameTaken', 'The username is already used.');
        }
        throw error;
      });
    },
  };
}
