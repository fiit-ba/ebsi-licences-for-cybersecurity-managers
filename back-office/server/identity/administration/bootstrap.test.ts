import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { bootstrapRootAdministrator } from './bootstrap.ts';
import { postgresOperatorManagement } from './management.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { passwordMatches } from '../auth/passwords.ts';

test('fresh deployment bootstraps its administrator and permission catalog without an identity import', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const previous = (await database.query('SELECT id FROM operator_permissions')).rows.map(
    (row) => row.id,
  );
  let account: number | undefined;
  let organization: string | undefined;
  context.after(async () => {
    try {
      await database.query('DELETE FROM accredited_organizations WHERE id=$1', [organization]);
      await database.query('DELETE FROM operator_accounts WHERE id=$1', [account]);
      await database.query('DELETE FROM operator_permissions WHERE NOT(id=ANY($1::integer[]))', [
        previous,
      ]);
    } finally {
      await database.end();
    }
  });
  const input = {
    username: 'bootstrap-' + randomUUID(),
    password: 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3',
    email: 'bootstrap@example.test',
    organization_name: 'Fresh Root Authority',
  };
  const result = await bootstrapRootAdministrator(database, input);
  account = result.account_id;
  organization = result.organization_id;
  const saved = await postgresAccounts(database).byId(account);
  assert.ok(saved);
  assert.equal(await passwordMatches(input.password, saved.password_hash), true);
  assert.deepEqual(saved.roles, ['plr_admin', 'plr_rtao']);
  assert.deepEqual(saved.governance_roles, []);
  const options = await postgresOperatorManagement(database).staff.options(account);
  assert.equal(options.scope, 'all');
  assert.equal(options.can_manage_privileges, true);
  assert.deepEqual(options.permissions.map((permission) => permission.codename).sort(), [
    'add_group',
    'add_user',
    'change_group',
    'change_user',
    'delete_group',
    'delete_user',
    'view_group',
    'view_user',
  ]);
  await assert.rejects(
    bootstrapRootAdministrator(database, input),
    (error) => (error as { body: { reason: string } }).body.reason === 'AlreadyBootstrapped',
  );
  assert.deepEqual(
    (await postgresOperatorManagement(database).staff.options(account)).permissions,
    options.permissions,
  );
});
