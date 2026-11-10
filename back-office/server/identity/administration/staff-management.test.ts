import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { operatorTokens } from '../auth/tokens.ts';
import { hashPassword } from '../auth/passwords.ts';
import { postgresOperatorManagement } from './management.ts';
import { operatorAdministrationLock } from './administration-lock.ts';
import type { StaffAccount } from '../../../shared/staff-accounts.ts';

test('staff writes enforce self scope, explicit grants, versioned sessions and privilege separation', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'staff-management-' + randomUUID();
  const ids: number[] = [];
  const base = randomInt(300_000_000, 400_000_000);
  const password = 'safe-staff-management-credential';
  for (const [name, staff, superuser] of [
    ['root', true, true],
    ['editor', true, false],
    ['viewer', true, false],
    ['ordinary', false, false],
  ] as const) {
    const id = (
      await database.query<{ id: number }>(
        `INSERT INTO operator_accounts(username,email,password_hash,is_staff,is_superuser)
      VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [
          prefix + '-' + name,
          name + '@example.test',
          await hashPassword(password),
          staff,
          superuser,
        ],
      )
    ).rows[0].id;
    ids.push(id);
  }
  const [root, editor, viewer, ordinary] = ids;
  await database.query(
    `INSERT INTO operator_permissions VALUES ($1,'auth','user','change_user','Can change user'),
    ($2,'auth','user','view_user','Can view user'),($3,'auth','user','add_user','Can add user')`,
    [base, base + 1, base + 2],
  );
  await database.query('INSERT INTO operator_account_permissions VALUES ($1,$2),($3,$4)', [
    editor,
    base,
    viewer,
    base + 1,
  ]);
  await database.query(
    "INSERT INTO operator_groups VALUES ($1,'plr_issuer'),($2,'plr_governance_b'),($3,'plr_admin')",
    [base, base + 1, base + 2],
  );
  const tokens = operatorTokens('staff-management-test-secret-'.repeat(2));
  const management = postgresOperatorManagement(database);
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    operatorManagement: management,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.query(
      'DELETE FROM operator_accounts WHERE id=ANY($1::integer[]) OR username LIKE $2',
      [ids, prefix + '%'],
    );
    await database.query('DELETE FROM operator_groups WHERE id BETWEEN $1 AND $2', [
      base,
      base + 2,
    ]);
    await database.query('DELETE FROM operator_permissions WHERE id BETWEEN $1 AND $2', [
      base,
      base + 2,
    ]);
    await database.end();
  });
  const session = async (id: number) =>
    (
      await tokens.pair({
        id,
        auth_version: (
          await database.query('SELECT auth_version FROM operator_accounts WHERE id=$1', [id])
        ).rows[0].auth_version,
      })
    ).access;
  const rootToken = await session(root);
  let editorToken = await session(editor);
  const viewToken = await session(viewer);
  const call = (token: string, path: string, body?: object) =>
    fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const edit = (current: StaffAccount, changes: object = {}) => ({
    account_id: current.id,
    version: current.version,
    username: current.username,
    email: current.email,
    first_name: current.first_name,
    last_name: current.last_name,
    active: current.active,
    is_staff: current.is_staff,
    is_superuser: current.is_superuser,
    group_ids: current.group_ids,
    permission_ids: current.permission_ids,
    ...changes,
  });

  await context.test(
    'view-only staff cannot edit and editors cannot address another account',
    async () => {
      const own = await (await call(viewToken, `/admin/accounts/${viewer}/`)).json();
      assert.equal(own.id, viewer);
      assert.equal(
        (await call(viewToken, '/admin/accounts/', edit(own, { first_name: 'changed' }))).status,
        403,
      );
      assert.equal((await call(editorToken, `/admin/accounts/${ordinary}/`)).status, 403);
      assert.equal(
        (
          await call(editorToken, '/admin/accounts/', {
            account_id: ordinary,
            version: 0,
            username: 'attacker',
            email: 'owner@example.test',
          })
        ).status,
        403,
      );
      assert.equal((await call(await session(ordinary), '/admin/accounts/options/')).status, 403);
    },
  );

  await context.test('personal edits preserve grants and revoke previous sessions', async () => {
    const current = await (await call(editorToken, `/admin/accounts/${editor}/`)).json();
    for (const changes of [
      { is_superuser: true },
      { group_ids: [base + 1] },
      { permission_ids: [base, base + 2] },
    ]) {
      const denied = await call(editorToken, '/admin/accounts/', edit(current, changes));
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).reason, 'PrivilegeChangeForbidden');
    }
    assert.equal(
      (await call(editorToken, '/admin/accounts/', edit(current, { password_hash: '!overwrite' })))
        .status,
      400,
    );
    const accepted = await call(
      editorToken,
      '/admin/accounts/',
      edit(current, { first_name: 'Updated', last_name: 'Editor' }),
    );
    assert.equal(accepted.status, 200);
    const updated = await accepted.json();
    assert.equal(updated.first_name, 'Updated');
    assert.equal(updated.version, current.version + 1);
    assert.deepEqual(updated.permission_ids, [base]);
    assert.equal('password_hash' in updated, false);
    assert.equal((await call(editorToken, '/registry/me/')).status, 401);
    editorToken = await session(editor);
    assert.equal(
      (await call(editorToken, '/admin/accounts/', edit(current, { first_name: 'stale' }))).status,
      409,
    );
  });

  await context.test(
    'superuser grants synchronize live business and signer roles without implicit platform admin',
    async () => {
      const current = await (await call(rootToken, `/admin/accounts/${ordinary}/`)).json();
      assert.equal(
        (await call(rootToken, '/admin/accounts/', edit(current, { group_ids: [base + 99] })))
          .status,
        400,
      );
      const accepted = await call(
        rootToken,
        '/admin/accounts/',
        edit(current, {
          group_ids: [base, base + 1, base + 2],
          permission_ids: [base + 1],
          is_staff: true,
        }),
      );
      assert.equal(accepted.status, 200);
      const profile = await (await call(await session(ordinary), '/registry/me/')).json();
      assert.deepEqual(profile.roles, ['plr_issuer']);
      assert.deepEqual(profile.governance_roles, ['B']);
      assert.equal(
        (
          await database.query(
            "SELECT 1 FROM operator_roles WHERE account_id=$1 AND role='plr_admin'",
            [ordinary],
          )
        ).rowCount,
        0,
      );
      const refreshed = await (await call(rootToken, `/admin/accounts/${ordinary}/`)).json();
      assert.equal(
        (await call(rootToken, '/admin/accounts/', edit(refreshed, { group_ids: [] }))).status,
        200,
      );
      const cleared = await (await call(await session(ordinary), '/registry/me/')).json();
      assert.deepEqual(cleared.roles, []);
      assert.deepEqual(cleared.governance_roles, []);
    },
  );

  await context.test(
    'add-only staff can create an ordinary account but cannot create a privileged one',
    async () => {
      await database.query('INSERT INTO operator_account_permissions VALUES ($1,$2)', [
        editor,
        base + 2,
      ]);
      const fields = {
        username: prefix + '-created',
        email: 'new-user@example.test',
        password: 'new-staff-created-credential',
      };
      assert.equal(
        (await call(editorToken, '/admin/accounts/', { ...fields, is_staff: true })).status,
        403,
      );
      const created = await call(editorToken, '/admin/accounts/', fields);
      assert.equal(created.status, 201);
      const account = await created.json();
      ids.push(account.id);
      assert.equal(account.is_staff, false);
      assert.equal(account.is_superuser, false);
      assert.deepEqual(account.group_ids, []);
      assert.equal((await call(editorToken, `/admin/accounts/${account.id}/`)).status, 403);
      assert.equal((await call(rootToken, '/admin/accounts/', fields)).status, 409);
      const audit = (
        await database.query(
          "SELECT detail FROM audit_entries WHERE event='account.created' AND detail->>'account_id'=$1",
          [String(account.id)],
        )
      ).rows;
      assert.equal(JSON.stringify(audit).includes(fields.password), false);
      assert.equal(JSON.stringify(audit).includes(fields.email), false);
    },
  );

  await context.test(
    'losing the actor session while queued cannot authorize a later write',
    async () => {
      const current = await management.staff.read(editor, editor);
      const guard = await database.connect();
      try {
        await guard.query('BEGIN');
        await guard.query('SELECT pg_advisory_xact_lock($1)', [operatorAdministrationLock]);
        const queued = management.staff.save(
          editor,
          edit(current, { first_name: 'must-not-commit' }),
          current.version,
        );
        const observed = queued.then(
          () => ({ ok: true, error: undefined }),
          (error) => ({ ok: false, error }),
        );
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          waiting = Boolean(
            (
              await guard.query(
                "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted",
                [operatorAdministrationLock],
              )
            ).rowCount,
          );
          if (waiting) break;
          await setTimeout(10);
        }
        assert.equal(waiting, true);
        await guard.query('UPDATE operator_accounts SET auth_version=auth_version+1 WHERE id=$1', [
          editor,
        ]);
        await guard.query('COMMIT');
        const result = await observed;
        assert.equal(result.ok, false);
        assert.equal(result.error.body.reason, 'SessionChanged');
        assert.notEqual(
          (await management.staff.read(editor, editor)).first_name,
          'must-not-commit',
        );
      } finally {
        await guard.query('ROLLBACK');
        guard.release();
      }
    },
  );
});
