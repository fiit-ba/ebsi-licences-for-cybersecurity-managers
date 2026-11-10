import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { readStaffAuthority, staffCanManageUser } from './staff-permissions.ts';
import { postgresOperatorManagement } from './management.ts';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { operatorTokens } from '../auth/tokens.ts';

test('staff entry, exact model permission and self-only scope remain distinct', () => {
  const staff = { id: 1, isStaff: true, isSuperuser: false, permissions: ['auth.view_user'] };
  assert.equal(staffCanManageUser(staff, 'view', 1), true);
  assert.equal(staffCanManageUser(staff, 'view', 2), false);
  assert.equal(staffCanManageUser(staff, 'change', 1), false);
  assert.equal(
    staffCanManageUser({ ...staff, permissions: ['auth.change_user'] }, 'view', 1),
    true,
  );
  assert.equal(
    staffCanManageUser({ ...staff, permissions: ['auth.change_user'] }, 'change', 1),
    true,
  );
  assert.equal(
    staffCanManageUser({ ...staff, isStaff: false, isSuperuser: true }, 'view', 1),
    false,
  );
  assert.equal(staffCanManageUser({ ...staff, isSuperuser: true }, 'change', 2), true);
  assert.equal(staffCanManageUser(undefined, 'view', 1), false);
});

test('administration permission projection uses live membership without granting business roles', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const username = 'staff-' + randomUUID();
  const account = (
    await database.query<{ id: number }>(
      `INSERT INTO operator_accounts(username,password_hash,is_staff)
    VALUES ($1,'!disabled',true) RETURNING id`,
      [username],
    )
  ).rows[0].id;
  const permissionId = 100_000_000 + Math.floor(Math.random() * 100_000_000);
  const groupId = permissionId;
  const tokens = operatorTokens('staff-permissions-test-secret-'.repeat(2));
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    operatorManagement: postgresOperatorManagement(database),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const session = await tokens.pair({ id: account });
  const headers = { authorization: 'Bearer ' + session.access };
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.query('DELETE FROM operator_accounts WHERE id=$1', [account]);
    await database.query('DELETE FROM operator_groups WHERE id=$1', [groupId]);
    await database.query('DELETE FROM operator_permissions WHERE id=$1', [permissionId]);
    await database.end();
  });
  await database.query(
    "INSERT INTO operator_permissions VALUES ($1,'auth','user','view_user','Can view user')",
    [permissionId],
  );
  await database.query('INSERT INTO operator_groups VALUES ($1,$2)', [groupId, username]);
  await database.query('INSERT INTO operator_group_permissions VALUES ($1,$2)', [
    groupId,
    permissionId,
  ]);
  await database.query('INSERT INTO operator_account_groups VALUES ($1,$2)', [account, groupId]);
  let authority = await readStaffAuthority(database, account);
  assert.equal(staffCanManageUser(authority, 'view', account), true);
  assert.equal(staffCanManageUser(authority, 'view', account + 1), false);
  assert.equal(staffCanManageUser(authority, 'change', account), false);
  const list = await fetch(origin + '/admin/accounts/', { headers });
  assert.equal(list.status, 200);
  const page = await list.json();
  assert.equal(page.total, 1);
  assert.deepEqual(
    page.results.map((value: { id: number }) => value.id),
    [account],
  );
  assert.equal('password_hash' in page.results[0], false);
  const hidden = await fetch(origin + '/admin/accounts/?q=not-this-staff-account', { headers });
  assert.equal((await hidden.json()).total, 0);
  assert.equal(
    (
      await fetch(origin + '/admin/accounts/', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: account, roles: ['plr_admin'], is_superuser: true }),
      })
    ).status,
    403,
  );
  await database.query('DELETE FROM operator_account_groups WHERE account_id=$1', [account]);
  authority = await readStaffAuthority(database, account);
  assert.equal(staffCanManageUser(authority, 'view', account), false);
  assert.equal((await fetch(origin + '/admin/accounts/', { headers })).status, 403);
  await database.query('INSERT INTO operator_account_permissions VALUES ($1,$2)', [
    account,
    permissionId,
  ]);
  authority = await readStaffAuthority(database, account);
  assert.equal(staffCanManageUser(authority, 'view', account), true);
  await database.query('UPDATE operator_accounts SET is_superuser=true WHERE id=$1', [account]);
  assert.equal(
    staffCanManageUser(await readStaffAuthority(database, account), 'change', account + 1),
    true,
  );
  assert.equal(
    (await database.query('SELECT 1 FROM operator_roles WHERE account_id=$1', [account])).rowCount,
    0,
  );
  assert.equal(
    (await database.query('SELECT 1 FROM operator_governance_roles WHERE account_id=$1', [account]))
      .rowCount,
    0,
  );
  await database.query('UPDATE operator_accounts SET active=false WHERE id=$1', [account]);
  assert.equal(await readStaffAuthority(database, account), undefined);
});
