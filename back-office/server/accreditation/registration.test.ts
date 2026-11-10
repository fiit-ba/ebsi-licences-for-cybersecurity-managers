import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { hashPassword } from '../identity/auth/passwords.ts';
import { postgresPasswordRecovery } from '../identity/recovery/password-recovery.ts';
import { postgresOperatorManagement } from '../identity/administration/management.ts';
import { postgresInvitations } from './invitations.ts';
import { postgresTrustChain } from './chain.ts';
import { postgresRegistrationThrottle } from './registration-throttle.ts';
import { registrationCases, registrationPayload } from './fixtures/registration-cases.ts';

test('public registration enforces the public HTTP contract and creates no activation mail', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'registration-' + randomUUID();
  const accounts: number[] = [];
  const organizations: string[] = [];
  const initialGroups = (
    await database.query<{ id: number }>('SELECT id FROM operator_groups')
  ).rows.map((row) => row.id);
  const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
  const secret = 'organization-registration-test-' + randomUUID();
  const tokens = operatorTokens(secret);
  let mail = 0;
  const recovery = postgresPasswordRecovery(database, {
    key: Buffer.alloc(32, 45),
    publicOrigin: 'https://registration.example.test',
    sendMail: async () => {
      mail++;
    },
  });
  const invitations = postgresInvitations(database);
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    invitations,
    trustChain: postgresTrustChain(database),
    passwordRecovery: recovery,
    operatorManagement: postgresOperatorManagement(database, recovery.queueActivation),
    trustedProxyHops: 1,
    registrationThrottle: postgresRegistrationThrottle(database, secret),
  });
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const registered = (
      await database.query<{ account_id: number }>(
        'SELECT account_id FROM accredited_organizations WHERE id=ANY($1::uuid[]) AND account_id IS NOT NULL',
        [organizations],
      )
    ).rows.map((row) => row.account_id);
    await database.query('DELETE FROM accreditation_events WHERE organization_id=ANY($1::uuid[])', [
      organizations,
    ]);
    await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
      organizations,
    ]);
    await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::integer[])', [
      [...accounts, ...registered],
    ]);
    await database.query(
      'DELETE FROM operator_groups WHERE NOT (id=ANY($1::integer[])) AND NOT EXISTS (SELECT 1 FROM operator_account_groups m WHERE m.group_id=operator_groups.id)',
      [initialGroups],
    );
    await database.end();
  });
  for (const username of [prefix + '.root', prefix + '.tao', 'occupied', prefix + '.standalone']) {
    accounts.push(
      (
        await database.query<{ id: number }>(
          'INSERT INTO operator_accounts(username,password_hash) VALUES ($1,$2) RETURNING id',
          [username, await hashPassword(password)],
        )
      ).rows[0].id,
    );
  }
  const [root, tao, occupied, standalone] = accounts;
  await database.query(
    "INSERT INTO operator_roles VALUES ($1,'plr_rtao'),($2,'plr_tao'),($3,'plr_rtao')",
    [root, tao, standalone],
  );
  const rootOrg = (
    await database.query<{ id: string }>(
      "INSERT INTO accredited_organizations(name,kind,account_id) VALUES ($1,'rtao',$2) RETURNING id",
      [prefix + '.root', root],
    )
  ).rows[0].id;
  organizations.push(rootOrg);
  const taoOrg = (
    await database.query<{ id: string }>(
      "INSERT INTO accredited_organizations(name,kind,account_id,parent_id) VALUES ($1,'tao',$2,$3) RETURNING id",
      [prefix + '.tao', tao, rootOrg],
    )
  ).rows[0].id;
  organizations.push(taoOrg);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const rootToken = (await tokens.pair({ id: root, auth_version: 0 })).access;
  const taoToken = (await tokens.pair({ id: tao, auth_version: 0 })).access;
  const post = (path: string, body: object, token?: string, address = '198.18.2.1') =>
    fetch(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': address,
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
    });

  for (let index = 0; index < registrationCases.length; index++) {
    const item = registrationCases[index];
    await context.test(item.name, async () => {
      const ti = ['ti', 'expired_accreditation', 'revoked_parent'].includes(item.scenario ?? '');
      const selected = await post(
        '/registry/trust-chain/select/',
        {
          name: prefix + '.' + item.name,
          contact_email: 'registration@example.test',
          schemas: [],
          ...(ti ? { accredited_until: new Date(Date.now() + 86400000 * 365).toISOString() } : {}),
        },
        ti ? taoToken : rootToken,
      );
      assert.equal(selected.status, 201);
      const selection = await selected.json();
      const id = selection.organization_id;
      organizations.push(id);
      if (item.scenario === 'expired_invitation')
        await database.query(
          "UPDATE accredited_organizations SET invitation_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [id],
        );
      if (item.scenario === 'expired_accreditation')
        await database.query(
          "UPDATE accredited_organizations SET accredited_until=clock_timestamp()-interval '1 second' WHERE id=$1",
          [id],
        );
      if (item.scenario === 'revoked_parent')
        await database.query(
          "UPDATE accredited_organizations SET revoked_at=clock_timestamp()-interval '1 second',revocation_reason='breach' WHERE id=$1",
          [taoOrg],
        );
      if (item.scenario === 'registered')
        await database.query(
          'UPDATE accredited_organizations SET account_id=$2,registered_at=clock_timestamp(),invitation_digest=NULL,invitation_expires_at=NULL WHERE id=$1',
          [id, occupied],
        );
      const payload = registrationPayload(item, selection.invitation);
      const response = await post(
        '/organizations/v1/registrations/',
        payload,
        undefined,
        '198.18.0.' + (index + 1),
      );
      const result = await response.json();
      assert.equal(response.status, item.status, JSON.stringify(result));
      if (item.reason) assert.equal(result.reason, item.reason);
      if (item.fields) assert.deepEqual(result.fields, item.fields);
      if (item.codes) assert.deepEqual(result.codes, item.codes);
      const row = (await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [id]))
        .rows[0];
      if (response.status === 201) {
        assert.equal(row.invitation_digest, null);
        assert.equal(row.invitation_expires_at, null);
        const expected = ti ? ['plr_issuer', 'plr_status_manager', 'plr_verifier'] : ['plr_tao'];
        assert.deepEqual(
          (
            await database.query(
              'SELECT role FROM operator_roles WHERE account_id=$1 ORDER BY role',
              [row.account_id],
            )
          ).rows.map((row) => row.role),
          expected,
        );
        assert.deepEqual(
          (
            await database.query(
              'SELECT g.name FROM operator_groups g JOIN operator_account_groups m ON m.group_id=g.id WHERE m.account_id=$1 ORDER BY g.name',
              [row.account_id],
            )
          ).rows.map((row) => row.name),
          expected,
        );
        const login = await post('/api/api-token-auth', {
          username: result.username,
          password: String(payload.password),
        });
        assert.equal(login.status, 200);
        assert.equal(
          (
            await post(
              '/organizations/v1/registrations/',
              payload,
              undefined,
              '198.18.0.' + (index + 1),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await database.query('SELECT 1 FROM operator_password_resets WHERE account_id=$1', [
              row.account_id,
            ])
          ).rowCount,
          0,
        );
      } else if (item.scenario !== 'registered') assert.equal(row.account_id, null);
    });
  }
  await recovery.deliver();
  assert.equal(mail, 0);
  await context.test(
    'the invitation has one concurrent winner and the chosen credentials remain exact',
    async () => {
      const selected = await invitations.select(root, { name: prefix + '.race' });
      organizations.push(selected.organization_id);
      const outcomes = await Promise.all(
        ['first', 'second'].map((suffix) =>
          post(
            '/organizations/v1/registrations/',
            { invitation: selected.invitation, username: prefix + '.race.' + suffix, password },
            undefined,
            '198.18.3.1',
          ),
        ),
      );
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [201, 404]);
      assert.equal(
        (
          await database.query(
            'SELECT count(*)::integer AS count FROM operator_accounts WHERE username LIKE $1',
            [prefix + '.race.%'],
          )
        ).rows[0].count,
        1,
      );
    },
  );
  await context.test(
    'only the registered accrediting organization may select children',
    async () => {
      const token = (await tokens.pair({ id: standalone, auth_version: 0 })).access;
      assert.equal(
        (await post('/registry/trust-chain/select/', { name: 'Forbidden' }, token)).status,
        403,
      );
    },
  );
  await context.test(
    'selection and renewal use the configured invitation lifetime and Unicode names',
    async () => {
      const configured = postgresInvitations(database, { invitationDays: 3 });
      const name = '🔐'.repeat(150);
      const selected = await configured.select(root, {
        name,
        contact_email: '\u0085contact@localhost\u0085',
      });
      organizations.push(selected.organization_id);
      const lifetime = +new Date(selected.invitation_expires_at) - Date.now();
      assert.ok(lifetime > 3 * 86400000 - 5000 && lifetime <= 3 * 86400000);
      assert.equal(selected.name, name);
      const renewed = await configured.renew(root, { organization_id: selected.organization_id });
      assert.ok(+new Date(renewed.invitation_expires_at) - Date.now() > 3 * 86400000 - 5000);
      assert.equal(
        (
          await post(
            '/organizations/v1/registrations/',
            { invitation: selected.invitation, username: prefix + '.old-invitation', password },
            undefined,
            '198.18.4.1',
          )
        ).status,
        404,
      );
      const stored = (
        await database.query('SELECT contact_email FROM accredited_organizations WHERE id=$1', [
          selected.organization_id,
        ])
      ).rows[0];
      assert.equal(stored.contact_email, 'contact@localhost');
    },
  );
});

test('registration limits retain old weighted-window behavior, atomic admission and trusted address scope', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  context.after(() => database.end());
  const key = 'registration-window-' + randomUUID();
  let instant = 1800003599;
  const limiter = postgresRegistrationThrottle(database, key, '10/hour', () => instant);
  const second = postgresRegistrationThrottle(database, key, '10/hour', () => instant);
  const attempts = await Promise.all(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? limiter : second)('192.0.2.10')),
  );
  assert.equal(attempts.filter((result) => result === null).length, 10);
  assert.deepEqual(
    attempts.filter((result) => result !== null),
    Array(10).fill(1),
  );
  instant = 1800003601;
  assert.equal(await limiter('192.0.2.10'), 3599);
  instant = 1800003961;
  assert.equal(await limiter('192.0.2.10'), null);
  assert.equal(await second('192.0.2.10'), 3239);
  assert.equal(await limiter('192.0.2.11'), null);
  assert.equal(
    JSON.stringify(
      (await database.query('SELECT * FROM organization_registration_limits')).rows,
    ).includes('192.0.2.10'),
    false,
  );
  const disabled = postgresRegistrationThrottle(database, key, '0/hour', () => instant);
  assert.ok(await disabled('192.0.2.12'));

  const tokens = operatorTokens(key);
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    invitations: postgresInvitations(database),
    registrationThrottle: postgresRegistrationThrottle(database, key, '2/hour', () => instant),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    for (let attempt = 0; attempt < 2; attempt++)
      assert.equal(
        (
          await fetch(origin + '/organizations/v1/registrations/', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': 'spoof-' + attempt },
            body: '{}',
          })
        ).status,
        400,
      );
    const blocked = await fetch(origin + '/organizations/v1/registrations/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'new-spoof' },
      body: '{}',
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  let admitted = 0;
  const off = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    invitations: postgresInvitations(database),
    registrationEnabled: false,
    registrationThrottle: async () => {
      admitted++;
      return null;
    },
  });
  off.listen(0, '127.0.0.1');
  await once(off, 'listening');
  try {
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:' +
            (off.address() as AddressInfo).port +
            '/organizations/v1/registrations/',
          { method: 'POST' },
        )
      ).status,
      404,
    );
    assert.equal(admitted, 0);
  } finally {
    await new Promise<void>((resolve) => off.close(() => resolve()));
  }
});
