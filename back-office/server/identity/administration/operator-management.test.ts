import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { hashPassword } from '../auth/passwords.ts';
import { operatorTokens } from '../auth/tokens.ts';
import { postgresOperatorManagement } from './management.ts';
import type { ManagedOperator } from '../../../shared/operator-accounts.ts';

test('account administration preserves authority, edit versions, session invalidation and audit privacy', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'account-' + randomUUID().slice(0, 8);
  const organizations = [randomUUID(), randomUUID(), randomUUID()];
  const ids: number[] = [];
  const password = 'management-test-password';
  const hash = await hashPassword(password);
  for (const [name, roles] of [
    ['admin', ['plr_admin']],
    ['auditor', ['plr_auditor']],
    ['ti', ['plr_issuer']],
    ['root-operator', ['plr_rtao']],
  ] as const) {
    const account = (
      await database.query<{ id: number }>(
        'INSERT INTO operator_accounts (username,password_hash) VALUES ($1,$2) RETURNING id',
        [prefix + '-' + name, hash],
      )
    ).rows[0];
    ids.push(account.id);
    await database.query('INSERT INTO operator_roles SELECT $1,unnest($2::text[])', [
      account.id,
      roles,
    ]);
  }
  context.after(async () => {
    try {
      await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query(
        'DELETE FROM operator_accounts WHERE id=ANY($1::integer[]) OR username LIKE $2',
        [ids, prefix + '-%'],
      );
    } finally {
      await database.end();
    }
  });
  await database.query(
    "INSERT INTO accredited_organizations (id,name,kind,account_id) VALUES ($1,'Management root','rtao',$2)",
    [organizations[0], ids[3]],
  );
  await database.query(
    "INSERT INTO accredited_organizations (id,name,kind,parent_id) VALUES ($1,'Management TAO','tao',$2)",
    [organizations[1], organizations[0]],
  );
  await database.query(
    "INSERT INTO accredited_organizations (id,name,kind,parent_id,account_id) VALUES ($1,'Management TI','ti',$2,$3)",
    [organizations[2], organizations[1], ids[2]],
  );
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens: operatorTokens('test-only-operator-management-secret'),
    operatorManagement: postgresOperatorManagement(database),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const request = (path: string, token?: string, body?: unknown) =>
    fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (name: string, secret = password) => {
    const response = await request('/api/api-token-auth', undefined, {
      username: prefix + '-' + name,
      password: secret,
    });
    return { status: response.status, ...(await response.json()) };
  };
  const admin = (await login('admin')).access as string;
  const auditor = (await login('auditor')).access as string;
  const root = (await login('root-operator')).access as string;
  const body = {
    username: prefix + '-manager',
    email: 'operator@example.test',
    active: true,
    password,
    roles: ['plr_status_manager'],
  };
  const edit = (account: ManagedOperator, changes: Record<string, unknown> = {}) => ({
    account_id: account.id,
    version: account.version,
    username: account.username,
    email: account.email,
    active: account.active,
    roles: account.roles,
    ...changes,
  });

  assert.equal((await request('/admin/accounts/')).status, 401);
  assert.equal((await request('/admin/accounts/', auditor)).status, 403);
  assert.equal((await request('/admin/accounts/', root)).status, 403);
  assert.equal((await request('/admin/accounts/', auditor, body)).status, 403);
  const profile = await (await request('/registry/me/', admin)).json();
  assert.equal(profile.account_id, ids[0]);
  assert.equal(profile.capabilities.accounts, true);
  assert.equal(
    (await request('/admin/accounts/', admin, { ...body, password: '12345678' })).status,
    400,
  );
  assert.equal(
    (await request('/admin/accounts/', admin, { ...body, password: 'password' })).status,
    400,
  );
  assert.equal(
    (await request('/admin/accounts/', admin, { ...body, roles: ['plr_admin', 'unknown'] })).status,
    400,
  );
  assert.equal(
    (
      await request('/admin/accounts/', admin, {
        ...body,
        roles: ['plr_rtao'],
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/admin/accounts/', admin, { ...body, status_issuer_ids: [] })).status,
    400,
  );
  assert.equal(
    (await request('/admin/accounts/', admin, { ...body, status_issuer_ids: [randomUUID()] }))
      .status,
    400,
  );

  const created = await request('/admin/accounts/', admin, body);
  assert.equal(created.status, 201);
  let manager = (await created.json()) as ManagedOperator;
  ids.push(manager.id);
  assert.equal('status_issuers' in manager, false);
  assert.equal('password_hash' in manager, false);
  assert.equal(JSON.stringify(manager).includes(password), false);
  assert.equal((await request('/admin/accounts/', admin, body)).status, 409);
  const initialToken = (await login('manager')).access;
  const search = await (await request('/admin/accounts/?q=' + prefix + '-manager', admin)).json();
  assert.equal(search.total, 1);
  assert.equal(search.results[0].id, manager.id);
  await database.query(
    `
    INSERT INTO operator_accounts (username,password_hash)
    SELECT $1 || '-bulk-' || n::text, $2 FROM generate_series(1,101) n
  `,
    [prefix, hash],
  );
  const firstPage = await (await request('/admin/accounts/?q=' + prefix + '-bulk-', admin)).json();
  assert.equal(firstPage.total, 101);
  assert.equal(firstPage.results.length, 100);
  assert.equal(firstPage.next, 100);
  const lastPage = await (
    await request('/admin/accounts/?q=' + prefix + '-bulk-&offset=100', admin)
  ).json();
  assert.equal(lastPage.results.length, 1);
  assert.equal(lastPage.next, null);
  assert.equal(
    firstPage.results.some((item) => item.id === lastPage.results[0].id),
    false,
  );
  assert.equal((await request('/admin/issuers/?q=Management%20TI', admin)).status, 404);
  const owner = (await (await request('/admin/accounts/?q=' + prefix + '-ti', admin)).json())
    .results[0] as ManagedOperator;
  assert.equal(
    (await request('/admin/accounts/', admin, edit(owner, { roles: ['plr_admin'] }))).status,
    400,
  );

  const race = await Promise.all([
    request('/admin/accounts/', admin, edit(manager, { email: 'winner-a@example.test' })),
    request('/admin/accounts/', admin, edit(manager, { email: 'winner-b@example.test' })),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [200, 409]);
  manager = (await race.find((response) => response.status === 200)!.json()) as ManagedOperator;
  assert.equal(manager.version, 1);
  assert.equal((await request('/registry/me/', initialToken)).status, 401);
  assert.equal(
    (await request('/admin/accounts/', admin, edit(manager, { version: 0 }))).status,
    409,
  );

  const beforeReset = (await login('manager')).access;
  const replacement = 'replacement-management-password';
  const reset = await request('/admin/accounts/', admin, edit(manager, { password: replacement }));
  assert.equal(reset.status, 200);
  manager = (await reset.json()) as ManagedOperator;
  assert.equal((await request('/registry/me/', beforeReset)).status, 401);
  assert.equal((await login('manager')).status, 401);
  const afterReset = await login('manager', replacement);
  assert.equal(afterReset.status, 200);
  manager = (await (
    await request('/admin/accounts/', admin, edit(manager, { active: false }))
  ).json()) as ManagedOperator;
  assert.equal((await login('manager', replacement)).status, 401);
  assert.equal((await request('/registry/me/', afterReset.access)).status, 401);
  manager = (await (
    await request('/admin/accounts/', admin, edit(manager, { active: true }))
  ).json()) as ManagedOperator;
  assert.equal((await request('/registry/me/', afterReset.access)).status, 401);
  assert.equal((await login('manager', replacement)).status, 200);
  assert.equal(
    (await database.query("SELECT to_regclass('ti_status_managers') AS obsolete")).rows[0].obsolete,
    null,
  );

  const secondResponse = await request('/admin/accounts/', admin, {
    ...body,
    username: prefix + '-admin-two',
    roles: ['plr_admin'],
  });
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()) as ManagedOperator;
  ids.push(second.id);
  const secondToken = (await login('admin-two')).access;
  const first = (
    await (await request('/admin/accounts/?q=' + prefix + '-admin', admin)).json()
  ).results.find((item) => item.id === ids[0]) as ManagedOperator;
  const demotions = await Promise.all([
    request('/admin/accounts/', admin, edit(first, { roles: [] })),
    request('/admin/accounts/', secondToken, edit(second, { roles: [] })),
  ]);
  assert.deepEqual(demotions.map((response) => response.status).sort(), [200, 409]);
  const survivor = demotions[0].status === 409 ? admin : secondToken;
  const demoted = demotions[0].status === 200 ? admin : secondToken;
  assert.equal((await request('/registry/me/', survivor)).status, 200);
  assert.equal((await request('/registry/me/', demoted)).status, 401);
  const refusal = await demotions.find((response) => response.status === 409)!.json();
  assert.equal(refusal.reason, 'LastAdministrator');
  assert.equal(
    (
      await database.query(
        "SELECT 1 FROM operator_roles WHERE account_id=ANY($1::integer[]) AND role='plr_admin'",
        [[first.id, second.id]],
      )
    ).rowCount,
    1,
  );

  const audit = (
    await database.query(
      'SELECT event,detail,payload FROM audit_entries WHERE actor_id=ANY($1::integer[])',
      [ids],
    )
  ).rows;
  assert.ok(audit.some((entry) => entry.event === 'account.created'));
  assert.ok(
    audit.some(
      (entry) => entry.event === 'account.password_reset' && entry.detail.account_id === manager.id,
    ),
  );
  assert.equal(JSON.stringify(audit).includes(password), false);
  assert.equal(JSON.stringify(audit).includes(replacement), false);
  assert.equal(JSON.stringify(audit).includes(hash), false);
});
