import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { operatorTokens } from '../auth/tokens.ts';
import { postgresOperatorManagement } from './management.ts';
import { postgresPasswordRecovery } from '../recovery/password-recovery.ts';
import { postgresLoginThrottle } from '../auth/login-throttle.ts';
import { appendAudit } from '../../audit/journal.ts';
import { transaction } from '../../adapters/transaction.ts';
import { hashPassword, passwordMatches } from '../auth/passwords.ts';
import type { RecoveryMail } from '../recovery/recovery-types.ts';

test('identity administration preserves group operations, account deletion, activation and password changes', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'identity-admin-' + randomUUID();
  const base = randomInt(500_000_000, 600_000_000);
  const ids: number[] = [];
  const password = 'separate-initial-account-credential';
  const messages: RecoveryMail[] = [];
  const recovery = postgresPasswordRecovery(database, {
    key: Buffer.alloc(32, 64),
    publicOrigin: 'https://accounts.example.test',
    sendMail: async (mail) => {
      messages.push(mail);
    },
  });
  const tokens = operatorTokens('identity-administration-test-key-'.repeat(2));
  const management = postgresOperatorManagement(database, recovery.queueActivation);
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    operatorManagement: management,
    passwordRecovery: recovery,
  });
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.query(
      'DELETE FROM operator_accounts WHERE id=ANY($1::integer[]) OR username LIKE $2',
      [ids, prefix + '%'],
    );
    await database.query('DELETE FROM operator_groups WHERE name LIKE $1 OR id BETWEEN $2 AND $3', [
      prefix + '%',
      base,
      base + 9,
    ]);
    await database.query('DELETE FROM operator_permissions WHERE id BETWEEN $1 AND $2', [
      base,
      base + 9,
    ]);
    await database.end();
  });
  for (const [name, staff, superuser] of [
    ['root', true, true],
    ['group-editor', true, false],
    ['password-only', true, false],
    ['ordinary', false, false],
    ['deleter', true, false],
  ] as const) {
    ids.push(
      (
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
      ).rows[0].id,
    );
  }
  const [root, editor, passwordOnly, ordinary, deleter] = ids;
  const codes = [
    'view_group',
    'add_group',
    'change_group',
    'delete_group',
    'change_user',
    'delete_user',
  ];
  for (let i = 0; i < codes.length; i++)
    await database.query('INSERT INTO operator_permissions VALUES ($1,$2,$3,$4,$5)', [
      base + i,
      'auth',
      codes[i].endsWith('_group') ? 'group' : 'user',
      codes[i],
      codes[i],
    ]);
  await database.query('INSERT INTO operator_account_permissions SELECT $1,unnest($2::integer[])', [
    editor,
    [base, base + 1, base + 2, base + 3],
  ]);
  await database.query('INSERT INTO operator_account_permissions VALUES ($1,$2)', [
    deleter,
    base + 5,
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const session = async (id: number) =>
    (
      await tokens.pair({
        id,
        auth_version: (
          await database.query('SELECT auth_version FROM operator_accounts WHERE id=$1', [id])
        ).rows[0].auth_version,
      })
    ).access;
  const call = async (token: string, path: string, body?: object) =>
    fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const rootToken = await session(root);

  await context.test(
    'the last active full administrator cannot deactivate their own account',
    async () => {
      const account = await management.staff.read(root, root);
      const refusal = await call(rootToken, '/admin/accounts/', {
        account_id: root,
        version: account.version,
        username: account.username,
        email: account.email,
        active: false,
      });
      assert.equal(refusal.status, 409);
      assert.equal((await refusal.json()).reason, 'LastAdministrator');
      assert.equal((await management.staff.read(root, root)).active, true);
      assert.equal((await call(rootToken, '/registry/me/')).status, 200);
    },
  );

  await context.test(
    'group grant changes are live, versioned and cannot promote a limited staff member',
    async () => {
      const create = await call(rootToken, '/admin/groups/', {
        name: prefix + '-members',
        permission_ids: [base + 4],
      });
      assert.equal(create.status, 201);
      const group = await create.json();
      assert.equal(
        (await call(rootToken, '/admin/groups/', { name: 'bad\0name', permission_ids: [] })).status,
        400,
      );
      await database.query('INSERT INTO operator_account_groups VALUES ($1,$2)', [
        ordinary,
        group.id,
      ]);
      const previous = await session(ordinary);
      const update = await call(rootToken, '/admin/groups/', {
        group_id: group.id,
        version: group.version,
        name: 'plr_verifier',
        permission_ids: [],
      });
      assert.equal(update.status, 200);
      assert.equal((await call(previous, '/registry/me/')).status, 401);
      assert.deepEqual(
        (await (await call(await session(ordinary), '/registry/me/')).json()).roles,
        ['plr_verifier'],
      );
      assert.equal(
        (
          await call(rootToken, '/admin/groups/', {
            group_id: group.id,
            version: group.version,
            name: 'stale',
            permission_ids: [],
          })
        ).status,
        409,
      );
      const editorToken = await session(editor);
      assert.equal(
        (
          await call(editorToken, '/admin/groups/', {
            name: prefix + '-escalation',
            permission_ids: [base + 4],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(editorToken, '/admin/groups/', {
            name: 'plr_governance_c',
            permission_ids: [],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(editorToken, '/admin/groups/', {
            name: prefix + '-ordinary',
            permission_ids: [base],
          })
        ).status,
        201,
      );
      const beforeRemoval = await session(ordinary);
      assert.equal(
        (
          await call(rootToken, '/admin/groups/delete/', {
            group_id: group.id,
            version: group.version + 1,
          })
        ).status,
        200,
      );
      assert.equal((await call(beforeRemoval, '/registry/me/')).status, 401);
      assert.deepEqual(
        (await (await call(await session(ordinary), '/registry/me/')).json()).roles,
        [],
      );
      assert.equal((await call(await session(passwordOnly), '/admin/groups/options/')).status, 403);
    },
  );

  await context.test(
    'account creation queues activation atomically and one-time confirmation preserves the chosen password',
    async () => {
      const created = await call(rootToken, '/admin/accounts/', {
        username: prefix + '-new',
        email: 'activation@example.test',
        password: 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3',
      });
      const account = await created.json();
      assert.equal(created.status, 201, JSON.stringify(account));
      ids.push(account.id);
      assert.equal(
        (
          await call(rootToken, '/admin/accounts/', {
            account_id: account.id,
            version: account.version,
            username: account.username,
            email: account.email,
            first_name: 'bad\0name',
          })
        ).status,
        400,
      );
      const old = await session(account.id);
      await recovery.deliver();
      const mail = messages.find((message) => message.to === 'activation@example.test')!;
      assert.equal(mail.purpose, 'activation');
      assert.equal(mail.username, account.username);
      const token = new URL(mail.url).hash.slice(1);
      await recovery.requestReset({ email: account.email }, 'activation-coexistence');
      await recovery.deliver();
      const resetMail = messages.find(
        (message) => message.to === account.email && message.purpose === 'recovery',
      )!;
      const resetToken = new URL(resetMail.url).hash.slice(1);
      assert.notEqual(resetToken, token);
      assert.equal((await recovery.validateToken({ token: resetToken })).status, 'OK');
      assert.equal((await recovery.validateToken({ token })).status, 'OK');
      await recovery.confirmReset({ token, password: 'M8!Zh4#Xq7@Nv2$Ks5%Gc9&Pr6' });
      await assert.rejects(recovery.validateToken({ token: resetToken }));
      assert.equal((await call(old, '/registry/me/')).status, 401);
      await assert.rejects(
        recovery.confirmReset({ token, password: 'another-final-account-credential' }),
        (error) => (error as { status: number }).status === 404,
      );
      const stored = (
        await database.query('SELECT password_hash FROM operator_accounts WHERE id=$1', [
          account.id,
        ])
      ).rows[0];
      assert.equal(await passwordMatches('M8!Zh4#Xq7@Nv2$Ks5%Gc9&Pr6', stored.password_hash), true);
      const failing = postgresOperatorManagement(database, async () => {
        throw new Error('isolated enqueue failure');
      });
      await assert.rejects(
        failing.staff.save(root, {
          username: prefix + '-rollback',
          email: 'rollback@example.test',
          password: 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3',
        }),
        /isolated enqueue failure/,
      );
      assert.equal(
        (
          await database.query('SELECT 1 FROM operator_accounts WHERE username=$1', [
            prefix + '-rollback',
          ])
        ).rowCount,
        0,
      );
    },
  );

  await context.test(
    'self password change checks the current password without requiring model permissions',
    async () => {
      const token = await session(passwordOnly);
      const body = {
        old_password: 'wrong',
        new_password1: ' chosen-password-with-spaces ',
        new_password2: ' chosen-password-with-spaces ',
      };
      assert.equal((await call(token, '/admin/password-change/', body)).status, 400);
      assert.equal(
        (
          await call(token, '/admin/password-change/', {
            ...body,
            old_password: password,
            new_password1: 'password',
            new_password2: 'password',
          })
        ).status,
        400,
      );
      assert.equal(
        (await call(token, '/admin/password-change/', { ...body, old_password: password })).status,
        200,
      );
      assert.equal((await call(token, '/registry/me/')).status, 401);
      const encoded = (
        await database.query('SELECT password_hash FROM operator_accounts WHERE id=$1', [
          passwordOnly,
        ])
      ).rows[0].password_hash;
      assert.equal(await passwordMatches(body.new_password1, encoded), true);
      assert.equal(await passwordMatches(body.new_password1.trim(), encoded), false);
      const longPassword = '🔐'.repeat(5000) + 'Z';
      const currentToken = await session(passwordOnly);
      const refusal = await call(currentToken, '/admin/password-change/', {
        old_password: body.new_password1,
        new_password1: longPassword,
        new_password2: longPassword,
      });
      assert.equal(refusal.status, 400);
      assert.equal((await refusal.json()).detail, 'password_too_long');
      assert.equal((await call(currentToken, '/registry/me/')).status, 200);
      assert.equal(
        (
          await database.query('SELECT password_hash FROM operator_accounts WHERE id=$1', [
            passwordOnly,
          ])
        ).rows[0].password_hash,
        encoded,
      );
      assert.equal(
        (
          await call('', '/api/api-token-auth', {
            username: prefix + '-password-only',
            password: body.new_password1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(await session(ordinary), '/admin/password-change/', {
            ...body,
            old_password: password,
          })
        ).status,
        403,
      );
    },
  );

  await context.test(
    'a first audit event and account deletion cannot race past history protection',
    async () => {
      const target = (
        await database.query<{ id: number }>(
          `INSERT INTO operator_accounts(username,password_hash) VALUES ($1,'!disabled') RETURNING id`,
          [prefix + '-audit-race'],
        )
      ).rows[0].id;
      ids.push(target);
      const writer = await database.connect();
      try {
        await writer.query('BEGIN');
        await appendAudit(writer, {
          event: 'account.updated',
          actor: target,
          detail: { account_id: target },
        });
        const queued = management.staff.remove(root, { account_id: target, version: 0 }, 0).then(
          () => ({ ok: true, error: undefined }),
          (error) => ({ ok: false, error }),
        );
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          await writer.query('SELECT pg_stat_clear_snapshot()');
          waiting = Boolean(
            (
              await writer.query(
                `SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%operator_accounts%FOR UPDATE%'`,
              )
            ).rowCount,
          );
          if (waiting) break;
          await setTimeout(10);
        }
        assert.equal(waiting, true);
        await writer.query('COMMIT');
        const result = await queued;
        assert.equal(result.ok, false);
        assert.equal(result.error.body.reason, 'ProtectedAccount');
        assert.equal(
          (await database.query('SELECT 1 FROM operator_accounts WHERE id=$1', [target])).rowCount,
          1,
        );
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
    },
  );

  await context.test(
    'deletion enforces self scope, protects domain history and preserves audit integrity',
    async () => {
      await transaction(database, (client) =>
        appendAudit(client, {
          event: 'account.updated',
          actor: ordinary,
          detail: { account_id: ordinary },
        }),
      );
      const token = await session(deleter);
      assert.equal((await call(token, `/admin/accounts/${deleter}/`)).status, 200);
      assert.equal(
        (await call(token, '/admin/accounts/delete/', { account_id: ordinary, version: 0 })).status,
        403,
      );
      const current = (
        await database.query('SELECT auth_version FROM operator_accounts WHERE id=$1', [ordinary])
      ).rows[0].auth_version;
      assert.equal(
        (
          await call(rootToken, '/admin/accounts/delete/', {
            account_id: ordinary,
            version: current - 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(rootToken, '/admin/accounts/delete/', {
            account_id: ordinary,
            version: current,
          })
        ).status,
        409,
      );
      const own = (
        await database.query('SELECT auth_version FROM operator_accounts WHERE id=$1', [deleter])
      ).rows[0].auth_version;
      assert.equal(
        (await call(token, '/admin/accounts/delete/', { account_id: deleter, version: own }))
          .status,
        200,
      );
      assert.equal((await call(token, '/registry/me/')).status, 401);
      await assert.rejects(
        transaction(database, (client) =>
          appendAudit(client, {
            event: 'account.updated',
            actor: deleter,
            detail: { account_id: deleter },
          }),
        ),
        /actor no longer exists/,
      );
      assert.equal(
        (await database.query('SELECT 1 FROM operator_accounts WHERE id=$1', [deleter])).rowCount,
        0,
      );
      assert.equal(
        (
          await database.query(
            "SELECT 1 FROM audit_entries WHERE event='account.deleted' AND detail->>'account_id'=$1",
            [String(deleter)],
          )
        ).rowCount,
        1,
      );
    },
  );
});

test('login admission is shared, bounded, nonenumerating and ignores spoofed forwarding headers', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  let lookups = 0;
  const key = 'isolated-login-limiter-' + randomUUID();
  const limiter = postgresLoginThrottle(database, key, 2);
  const second = postgresLoginThrottle(database, key, 2);
  const accounts = {
    byUsername: async () => {
      lookups++;
      return undefined;
    },
    byId: async () => undefined,
  };
  const server = backOfficeServer({
    accounts,
    tokens: operatorTokens(key),
    loginThrottle: limiter,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.end();
  });
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/api-token-auth';
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': 'spoof-' + i },
          body: JSON.stringify({ username: 'unknown-' + i, password: 'incorrect' }),
        })
      ).status,
      401,
    );
  const denied = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'spoof-final' },
    body: JSON.stringify({ username: 'known', password: 'incorrect' }),
  });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.equal(lookups, 2);
  assert.ok(await second('127.0.0.1'));
});
