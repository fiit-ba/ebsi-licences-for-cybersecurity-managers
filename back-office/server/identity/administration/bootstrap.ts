import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { hashPassword } from '../auth/passwords.ts';
import { OperatorManagementError } from './management-error.ts';
import { operatorCredentials } from './operator-credentials.ts';
import { operatorAdministrationLock } from './administration-lock.ts';

/**
 * Provision the first administrator and RootTAO without an HTTP bootstrap backdoor.
 * @param database - PostgreSQL pool controlled by the deployment operator.
 * @param input - Initial username, email, password and RootTAO organization name.
 * @returns Public account and organization identifiers; never password material.
 * @throws OperatorManagementError if input is invalid or any root/admin already exists;
 * password-hashing, database or audit errors.
 * @remarks Run once after migrations on the fresh deployment. Seeds account/group
 * permissions and grants the initial operator full administration, without signer roles.
 * The advisory lock also serializes normal admin edits.
 */
export async function bootstrapRootAdministrator(database: Pool, input: Record<string, unknown>) {
  const credentials = operatorCredentials(input, true);
  const name = typeof input.organization_name === 'string' ? input.organization_name.trim() : '';
  if (!name || name.length > 200)
    throw new OperatorManagementError(
      400,
      'InvalidFields',
      'Supply a RootTAO name of up to 200 characters.',
    );
  const password = await hashPassword(credentials.password!);
  return transaction(database, async (client: PoolClient) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [operatorAdministrationLock]);
    const { rowCount } = await client.query(`
      SELECT 1 WHERE EXISTS (SELECT 1 FROM operator_roles WHERE role = 'plr_admin')
        OR EXISTS (SELECT 1 FROM accredited_organizations WHERE kind = 'rtao')
    `);
    if (rowCount)
      throw new OperatorManagementError(
        409,
        'AlreadyBootstrapped',
        'A RootTAO or administrator already exists.',
      );
    await client.query(`
      INSERT INTO operator_permissions(app_label, model, codename, name)
      SELECT 'auth', model, action || '_' || model,
        'Can ' || action || ' ' || model
      FROM (VALUES ('user'), ('group')) AS models(model)
      CROSS JOIN (VALUES ('add'), ('change'), ('delete'), ('view')) AS actions(action)
      ON CONFLICT (app_label, model, codename) DO NOTHING
    `);
    const account = (
      await client.query<{ id: number }>(
        `
      INSERT INTO operator_accounts (username,email,password_hash,is_staff,is_superuser) VALUES ($1,$2,$3,true,true)
      ON CONFLICT (username) DO NOTHING RETURNING id
    `,
        [credentials.username, credentials.email, password],
      )
    ).rows[0];
    if (!account)
      throw new OperatorManagementError(409, 'UsernameTaken', 'The username is already used.');
    await client.query("INSERT INTO operator_roles VALUES ($1,'plr_admin'),($1,'plr_rtao')", [
      account.id,
    ]);
    const organization = (
      await client.query<{ id: string }>(
        `
      INSERT INTO accredited_organizations (name,kind,account_id) VALUES ($1,'rtao',$2) RETURNING id
    `,
        [name, account.id],
      )
    ).rows[0];
    await appendAudit(client, {
      event: 'account.created',
      actor: account.id,
      detail: {
        account_id: account.id,
        roles: ['plr_admin', 'plr_rtao'],
        active: true,
        version: 0,
      },
    });
    await appendAudit(client, {
      event: 'organization.registered',
      actor: account.id,
      organizationId: organization.id,
    });
    return {
      account_id: account.id,
      username: credentials.username,
      organization_id: organization.id,
    };
  });
}
