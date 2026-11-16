import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../auth/accounts.ts';
import { hashPassword, passwordMatches } from '../auth/passwords.ts';
import { operatorTokens } from '../auth/tokens.ts';
import { postgresPasswordRecovery } from './password-recovery.ts';
import type { RecoveryMail } from './recovery-types.ts';

test('password recovery preserves public contracts and atomically consumes version-bound credentials', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const suffix = randomUUID();
  const email = `recovery-${suffix}@example.test`;
  const accounts: number[] = [];
  const organizations: string[] = [];
  const mailed: RecoveryMail[] = [];
  const reports: string[] = [];
  let rejectMail = false;
  const recovery = postgresPasswordRecovery(database, {
    key: Buffer.alloc(32, 77),
    publicOrigin: 'https://console.example.test',
    requestsPerDay: 1000,
    sendMail: async (mail) => {
      if (rejectMail) throw new Error('Provider error with confidential content');
      mailed.push(mail);
    },
    reportDeliveryError: () => reports.push('pending'),
  });
  const tokens = operatorTokens('recovery-test-token-secret-'.repeat(2));
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    passwordRecovery: recovery,
  });
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
      organizations,
    ]);
    await database.query('DELETE FROM operator_accounts WHERE id = ANY($1::integer[])', [accounts]);
    await database.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (path: string, body: object, headers: Record<string, string> = {}) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const requestPath = '/api/password_reset/';
  const validatePath = '/api/password_reset/validate_token/';
  const confirmPath = '/api/password_reset/confirm/';
  const account = (
    await database.query<{ id: number }>(
      `INSERT INTO operator_accounts(username,email,password_hash,first_name)
    VALUES ($1,$2,$3,'RecoveryName') RETURNING id`,
      ['recovery-' + suffix, email, await hashPassword('original-recovery-password')],
    )
  ).rows[0];
  accounts.push(account.id);
  const oldSession = await tokens.pair({ id: account.id, auth_version: 0 });
  const profile = (token: string) =>
    fetch(origin + '/registry/me/', { headers: { authorization: `Bearer ${token}` } });

  await context.test(
    'known and unknown email requests disclose the same status and body, with no bearer in API or storage',
    async () => {
      const known = await post(requestPath, { email: email.toUpperCase() });
      const unknown = await post(requestPath, { email: `missing-${suffix}@example.test` });
      assert.equal(known.status, 200);
      assert.equal(unknown.status, 200);
      assert.deepEqual(await known.json(), await unknown.json());
      await recovery.deliver();
      assert.equal(mailed.length, 1);
      assert.equal(mailed[0].to, email);
      assert.equal(new URL(mailed[0].url).origin, 'https://console.example.test');
      const token = new URL(mailed[0].url).hash.slice(1);
      assert.match(token, /^[a-f0-9]{64}$/);
      const stored = (
        await database.query('SELECT * FROM operator_password_resets WHERE account_id = $1', [
          account.id,
        ])
      ).rows[0];
      assert.equal(JSON.stringify(stored).includes(token), false);
      assert.equal(Math.round((+stored.expires_at - +stored.created_at) / 1000), 86400);
      assert.equal((await post(validatePath, { token })).status, 200);
      assert.equal((await post(validatePath, { token, uid: 'MQ' })).status, 404);
      assert.equal((await post(validatePath, { token: 'x'.repeat(64) })).status, 404);
      assert.equal((await post(validatePath, {})).status, 400);
    },
  );

  const token = new URL(mailed[0].url).hash.slice(1);
  await context.test(
    'resend and uncertain delivery retain the same reset token and safe failure report',
    async () => {
      await post(requestPath, { email });
      rejectMail = true;
      await database.query(
        'UPDATE operator_password_resets SET attempted_at = NULL WHERE account_id = $1',
        [account.id],
      );
      await recovery.deliver();
      assert.deepEqual(reports, ['pending']);
      assert.equal(mailed.length, 1);
      await recovery.deliver();
      assert.equal(reports.length, 1);
      rejectMail = false;
      await database.query(
        'UPDATE operator_password_resets SET attempted_at = NULL WHERE account_id = $1',
        [account.id],
      );
      await recovery.deliver();
      assert.equal(mailed[1].url, mailed[0].url);
    },
  );

  await context.test(
    'password-policy refusals do not consume the token or change the old password',
    async () => {
      for (const [password, message] of [
        ['password', 'Use at least 15 characters.'],
        [
          'PasswordPassword1!',
          'Choose a less predictable password or a longer phrase with unrelated words.',
        ],
        [
          '²'.repeat(20),
          'Choose a less predictable password or a longer phrase with unrelated words.',
        ],
        ['🔐'.repeat(129), 'Use at most 128 characters.'],
      ]) {
        const response = await post(confirmPath, { token, password });
        assert.equal(response.status, 400);
        assert.deepEqual((await response.json()).password, [message]);
        assert.equal((await post(validatePath, { token })).status, 200);
      }
      const stored = (
        await database.query('SELECT password_hash FROM operator_accounts WHERE id = $1', [
          account.id,
        ])
      ).rows[0];
      assert.equal(await passwordMatches('original-recovery-password', stored.password_hash), true);
    },
  );

  await context.test(
    'parallel confirmations have one winner, revoke prior sessions and journal no secrets',
    async () => {
      const replacement = 'replacement-recovery-credential';
      const responses = await Promise.all([
        post(confirmPath, { token, password: ' \u0085' + replacement + '\u001c ' }),
        post(confirmPath, { token, password: ' \u0085' + replacement + '\u001c ' }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 404]);
      assert.equal((await post(validatePath, { token })).status, 404);
      assert.equal((await profile(oldSession.access)).status, 401);
      assert.equal(
        (
          await post('/api/api-token-auth', {
            username: 'recovery-' + suffix,
            password: 'original-recovery-password',
          })
        ).status,
        401,
      );
      const signedIn = await post('/api/api-token-auth', {
        username: 'recovery-' + suffix,
        password: replacement,
      });
      assert.equal(signedIn.status, 200);
      assert.equal((await profile((await signedIn.json()).access)).status, 200);
      const audit = (
        await database.query(
          `SELECT detail FROM audit_entries WHERE event = 'account.password_reset' AND actor_id = $1`,
          [account.id],
        )
      ).rows;
      assert.equal(audit.length, 1);
      assert.deepEqual(audit[0].detail, { account_id: account.id });
      assert.equal(JSON.stringify(audit).includes(token), false);
      assert.equal(JSON.stringify(audit).includes(replacement), false);
    },
  );

  await context.test(
    'expiry, email/version changes and deactivation invalidate outstanding links',
    async () => {
      for (const mutation of [
        `UPDATE operator_password_resets SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE account_id = $1`,
        `UPDATE operator_accounts SET email = 'changed-${suffix}@example.test' WHERE id = $1`,
        `UPDATE operator_accounts SET auth_version = auth_version + 1 WHERE id = $1`,
        `UPDATE operator_accounts SET active = false WHERE id = $1`,
      ]) {
        await database.query(
          'UPDATE operator_accounts SET email = $2, active = true WHERE id = $1',
          [account.id, email],
        );
        await post(requestPath, { email });
        await database.query(
          'UPDATE operator_password_resets SET attempted_at = NULL WHERE account_id = $1',
          [account.id],
        );
        await recovery.deliver();
        const link = new URL(mailed.at(-1)!.url).hash.slice(1);
        await database.query(mutation, [account.id]);
        assert.equal(
          (await post(confirmPath, { token: link, password: 'another-safe-reset-credential' }))
            .status,
          404,
        );
        await database.query('DELETE FROM operator_password_resets WHERE account_id = $1', [
          account.id,
        ]);
      }
    },
  );

  await context.test(
    'a revoked ancestor prevents recovery without disclosing the account through the public request',
    async () => {
      await database.query('UPDATE operator_accounts SET email = $2, active = true WHERE id = $1', [
        account.id,
        email,
      ]);
      const root = randomUUID();
      const tao = randomUUID();
      const ti = randomUUID();
      organizations.push(root, tao, ti);
      await database.query(
        "INSERT INTO accredited_organizations(id,name,kind) VALUES ($1,'Recovery root','rtao')",
        [root],
      );
      await database.query(
        "INSERT INTO accredited_organizations(id,name,kind,parent_id) VALUES ($1,'Recovery authority','tao',$2)",
        [tao, root],
      );
      await database.query(
        "INSERT INTO accredited_organizations(id,name,kind,parent_id,account_id) VALUES ($1,'Recovery issuer','ti',$2,$3)",
        [ti, tao, account.id],
      );
      await post(requestPath, { email });
      await recovery.deliver();
      const link = new URL(mailed.at(-1)!.url).hash.slice(1);
      const before = mailed.length;
      await database.query(
        "UPDATE accredited_organizations SET revoked_at=now(), revocation_reason='breach' WHERE id=$1",
        [tao],
      );
      const response = await post(requestPath, { email });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'OK' });
      assert.equal((await post(validatePath, { token: link })).status, 404);
      assert.equal(
        (await post(confirmPath, { token: link, password: 'safe-but-revoked-recovery-password' }))
          .status,
        404,
      );
      await recovery.deliver();
      assert.equal(mailed.length, before);
    },
  );
});

test('recovery request throttling is shared across service instances without storing raw client identities', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  context.after(() => database.end());
  const key = Buffer.alloc(32, 19);
  const options = { key, publicOrigin: 'https://console.example.test', sendMail: async () => {} };
  const first = postgresPasswordRecovery(database, options);
  const second = postgresPasswordRecovery(database, options);
  const id = randomUUID();
  const email = 'unknown@example.test';
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? first : second).requestReset({ email }, id),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  for (const result of results)
    if (result.status === 'rejected') {
      assert.equal(result.reason.status, 429);
      assert.ok(result.reason.retryAfter > 0);
    }
  const rows = await database.query('SELECT bucket FROM operator_recovery_limits');
  assert.equal(JSON.stringify(rows.rows).includes(id), false);
});
