import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import pg from 'pg';
import { postgresAccounts } from './accounts.ts';
import { hashPassword } from './passwords.ts';
import { operatorTokens } from './tokens.ts';
import { postgresSchemaCatalog } from '../../schemas/catalog.ts';
import { backOfficeServer } from '../../http/app.ts';

test('login and profile use the current database account and role assignments', async (context) => {
  assert.equal(
    process.env.PGDATABASE,
    'atest_back_office_test',
    'Use a disposable database named atest_back_office_test.',
  );
  const database = new pg.Pool();
  const root = randomUUID();
  const tao = randomUUID();
  const ti = randomUUID();
  const schema = randomUUID();
  const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
  // The integration suite must run against a freshly migrated disposable DB.
  const {
    rows: [account],
  } = await database.query(
    'INSERT INTO operator_accounts (username, password_hash) VALUES ($1, $2) RETURNING id',
    ['tester', await hashPassword(password)],
  );
  context.after(async () => {
    try {
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id = $1', [
        schema,
      ]);
      await database.query('DELETE FROM certificate_schemas WHERE id = $1', [schema]);
      await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
        [ti, tao, root],
      ]);
      await database.query('DELETE FROM operator_accounts WHERE id = $1', [account.id]);
    } finally {
      await database.end();
    }
  });
  await database.query('INSERT INTO operator_roles VALUES ($1, $2)', [account.id, 'plr_verifier']);

  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens: operatorTokens('test-only-secret-for-the-identity-suite'),
    schemaCatalog: postgresSchemaCatalog(database),
    ready: () => database.query('SELECT 1'),
    governanceProfile: { contract: '0x' + 'ab'.repeat(20), consoleRoles: ['A', 'B'] },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = (username, password) =>
    fetch(origin + '/api/api-token-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  const profile = (token) =>
    fetch(origin + '/registry/me/', {
      headers: { authorization: `Bearer ${token}` },
    });

  assert.equal((await fetch(origin + '/health/ready')).status, 200);
  const unknown = await login('unknown', password);
  const wrongPassword = await login('tester', 'wrong');
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  const loginRefusal = await unknown.json();
  assert.deepEqual(loginRefusal, await wrongPassword.json());
  assert.equal((await login('tester', 'x'.repeat(5000))).status, 401);
  assert.equal((await login('tester', 'x'.repeat(2_621_440))).status, 413);
  assert.equal((await login(' \u0085tester\u001c ', password)).status, 200);
  assert.equal((await login('\ufefftester', password)).status, 401);

  await context.test(
    'matching scrypt hashes do not exempt passwords from the account policy at login',
    async () => {
      for (const [candidate, firstName, lastName] of [
        ['test-password', '', ''],
        ['PasswordPassword1!', '', ''],
        [password.repeat(5), '', ''],
        [password, password, ''],
        [password, '', password],
      ]) {
        const hash = await hashPassword(candidate);
        await database.query(
          'UPDATE operator_accounts SET password_hash=$2,first_name=$3,last_name=$4 WHERE id=$1',
          [account.id, hash, firstName, lastName],
        );
        const refused = await login('tester', candidate);
        assert.equal(refused.status, 401);
        assert.deepEqual(await refused.json(), loginRefusal);
        assert.equal(
          (
            await database.query('SELECT password_hash FROM operator_accounts WHERE id=$1', [
              account.id,
            ])
          ).rows[0].password_hash,
          hash,
        );
      }
      await database.query(
        "UPDATE operator_accounts SET password_hash=$2,first_name='',last_name='' WHERE id=$1",
        [account.id, await hashPassword(password)],
      );
    },
  );

  const response = await login('tester', password);
  assert.equal(response.status, 200);
  const session = await response.json();
  const storedHash = (
    await database.query('SELECT password_hash FROM operator_accounts WHERE id=$1', [account.id])
  ).rows[0].password_hash;
  assert.equal(JSON.stringify(session).includes(storedHash), false);
  assert.equal(
    JSON.stringify(await (await profile(session.access)).json()).includes(storedHash),
    false,
  );
  assert.equal(session.user_id, account.id);
  assert.equal(session.username, 'tester');
  assert.ok(decodeJwt(session.access).exp > Date.now() / 1000);

  assert.equal((await profile(session.refresh)).status, 401);
  assert.equal((await profile('invalid')).status, 401);
  assert.deepEqual((await (await profile(session.access)).json()).roles, ['plr_verifier']);

  await context.test(
    'governance roles are explicit, deployment-filtered and read live',
    async () => {
      await database.query("INSERT INTO operator_roles VALUES ($1, 'plr_admin')", [account.id]);
      let current = await (await profile(session.access)).json();
      assert.deepEqual(current.governance_roles, []);
      assert.equal(current.governance_contract, '0x' + 'ab'.repeat(20));
      await database.query(
        "INSERT INTO operator_governance_roles VALUES ($1, 'A'), ($1, 'B'), ($1, 'C')",
        [account.id],
      );
      current = await (await profile(session.access)).json();
      assert.deepEqual(current.governance_roles, ['A', 'B']);
      await database.query(
        "DELETE FROM operator_governance_roles WHERE account_id = $1 AND role = 'B'",
        [account.id],
      );
      current = await (await profile(session.access)).json();
      assert.deepEqual(current.governance_roles, ['A']);
      await database.query('DELETE FROM operator_governance_roles WHERE account_id = $1', [
        account.id,
      ]);
    },
  );

  await database.query('DELETE FROM operator_roles WHERE account_id = $1', [account.id]);
  assert.deepEqual((await (await profile(session.access)).json()).roles, []);
  await database.query('UPDATE operator_accounts SET active = false WHERE id = $1', [account.id]);
  const revoked = await profile(session.access);
  assert.equal(revoked.status, 401);
  assert.equal((await revoked.json()).code, 'token_not_valid');
  assert.equal((await login('tester', password)).status, 401);

  await context.test(
    'only the approved hierarchy is valid and a parent revocation blocks active TI tokens',
    async () => {
      await database.query(
        "INSERT INTO accredited_organizations (id, name, kind) VALUES ($1, 'Root', 'rtao')",
        [root],
      );
      await assert.rejects(
        database.query(
          "INSERT INTO accredited_organizations (name, kind, parent_id) VALUES ('Invalid', 'ti', $1)",
          [root],
        ),
        { code: '23503' },
      );
      await database.query(
        "INSERT INTO accredited_organizations (id, name, kind, parent_id) VALUES ($1, 'Authority', 'tao', $2)",
        [tao, root],
      );
      await database.query(
        `
      INSERT INTO accredited_organizations (id, name, kind, parent_id, account_id, did, accredited_until)
      VALUES ($1, 'Issuer', 'ti', $2, $3, 'did:example:issuer', now() - interval '1 second')
    `,
        [ti, tao, account.id],
      );
      await database.query('UPDATE operator_accounts SET active = true WHERE id = $1', [
        account.id,
      ]);
      await database.query('INSERT INTO operator_roles VALUES ($1, $2)', [
        account.id,
        'plr_status_manager',
      ]);

      const active = await (await profile(session.access)).json();
      assert.equal(active.organization_kind, 'ti');
      assert.equal(active.organization_did, 'did:example:issuer');
      assert.equal(active.accreditation_ended, true);
      assert.equal(active.emergency_suspension_scope, 'own');

      await database.query(
        `
      UPDATE accredited_organizations SET revoked_at = now(), revocation_reason = 'breach' WHERE id = $1
    `,
        [tao],
      );
      for (const refused of [await profile(session.access), await login('tester', password)]) {
        assert.equal(refused.status, 401);
        const body = await refused.json();
        assert.equal(body.reason, 'AccreditationRevoked');
        assert.equal(body.revoked_organization_kind, 'tao');
      }
      const wrong = await login('tester', 'wrong');
      assert.deepEqual(
        await wrong.json(),
        await login('unknown', 'wrong').then((result) => result.json()),
      );
    },
  );

  await context.test(
    'the public Wallet catalog includes retired schemas and ignores draft labels',
    async () => {
      await database.query(
        `
      INSERT INTO certificate_schemas (id, credential_type, name_sk, name_en, retired_at)
      VALUES ($1, 'TestLicense', 'Licencia', 'License', now())
    `,
        [schema],
      );
      await database.query(
        `
      INSERT INTO certificate_schema_versions (schema_id, version, fields, tsr_id, registered_at)
      VALUES ($1, 1, $2, 'tsr-one', now()), ($1, 2, $3, 'tsr-two', now()), ($1, 3, $4, NULL, NULL)
    `,
        [
          schema,
          JSON.stringify([
            { key: 'code', label: { sk: 'Číslo' } },
            { key: 'holder', label: { en: 'Holder' } },
          ]),
          JSON.stringify([{ key: 'code', label: { en: 'Number' } }]),
          JSON.stringify([{ key: 'code', label: { en: 'Draft' } }]),
        ],
      );
      const response = await fetch(origin + '/registry/schema-names/');
      assert.equal(response.status, 200);
      const { schemas } = await response.json();
      assert.deepEqual(
        schemas.find((entry) => entry.credential_type === 'TestLicense'),
        {
          credential_type: 'TestLicense',
          name: { sk: 'Licencia', en: 'License' },
          labels: { code: { sk: '', en: 'Number' }, holder: { sk: '', en: 'Holder' } },
        },
      );
    },
  );
});
