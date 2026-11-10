import pg from 'pg';
import { backOfficeServer } from '../server/http/app.ts';
import { loadConsoleAssets } from '../server/http/console.ts';
import { postgresAccounts } from '../server/identity/auth/accounts.ts';
import { operatorTokens } from '../server/identity/auth/tokens.ts';
import { hashPassword } from '../server/identity/auth/passwords.ts';
import { postgresPasswordRecovery } from '../server/identity/recovery/password-recovery.ts';
import { postgresOperatorManagement } from '../server/identity/administration/management.ts';

if (process.env.PGDATABASE !== 'atest_back_office_test') {
  throw new Error(
    'Live identity browser checks require the disposable atest_back_office_test database.',
  );
}
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });

/**
 * Remove only this runner's synthetic fixtures from the explicitly disposable database.
 * @returns Completion after account/grant fixtures and private mail-capture tables are gone.
 * @throws Database errors.
 */
async function cleanupFixtures(): Promise<void> {
  await database.query('DELETE FROM operator_accounts WHERE username=ANY($1::text[])', [
    [
      'live.identity',
      'live.recovery',
      'live.staff.root',
      'live.staff.editor',
      'live.staff.viewer',
      'live.staff.created',
      'live.activation',
    ],
  ]);
  await database.query(
    "DELETE FROM operator_groups WHERE id IN (900000001,900000002) OR name IN ('browser.reviewers','browser.reviewers.updated')",
  );
  await database.query('DELETE FROM operator_permissions WHERE id IN (900000001,900000002)');
  await database.query('DROP TABLE IF EXISTS identity_browser_mail');
}
await cleanupFixtures();
const passwordHash = await hashPassword('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
await database.query(
  `
  INSERT INTO operator_accounts(username, password_hash, email)
  VALUES ('live.identity', $1, 'live.identity@example.test')
`,
  [passwordHash],
);
await database.query(`
  INSERT INTO operator_roles(account_id, role)
  SELECT id, 'plr_verifier' FROM operator_accounts WHERE username = 'live.identity'
`);
await database.query(
  `INSERT INTO operator_accounts(username, password_hash, email)
  VALUES ('live.recovery', $1, 'live.recovery@example.test')`,
  [passwordHash],
);
await database.query(`INSERT INTO operator_roles(account_id, role)
  SELECT id, 'plr_verifier' FROM operator_accounts WHERE username = 'live.recovery'`);
// Synthetic mail capture is confined to this explicitly disposable test database.
await database.query(
  'CREATE TABLE identity_browser_mail (recipient text NOT NULL, url text NOT NULL)',
);
const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_IDENTITY_TEST_PORT ?? '8790');
const recovery = postgresPasswordRecovery(database, {
  key: Buffer.alloc(32, 99),
  publicOrigin: origin,
  requestsPerDay: 1000,
  sendMail: async (mail) => {
    await database.query('INSERT INTO identity_browser_mail VALUES ($1,$2)', [mail.to, mail.url]);
  },
});
for (const [username, superuser] of [
  ['live.staff.root', true],
  ['live.staff.editor', false],
  ['live.staff.viewer', false],
] as const) {
  await database.query(
    `INSERT INTO operator_accounts(username,email,password_hash,is_staff,is_superuser)
    VALUES ($1,$2,$3,true,$4)`,
    [username, username + '@example.test', passwordHash, superuser],
  );
}
await database.query(`INSERT INTO operator_permissions VALUES
  (900000001,'auth','user','change_user','Can change user'),
  (900000002,'auth','user','view_user','Can view user')`);
await database.query(`INSERT INTO operator_account_permissions SELECT id,900000001 FROM operator_accounts WHERE username='live.staff.editor';
  INSERT INTO operator_account_permissions SELECT id,900000002 FROM operator_accounts WHERE username='live.staff.viewer';
  INSERT INTO operator_groups VALUES (900000001,'plr_verifier'),(900000002,'plr_governance_b')`);
const server = backOfficeServer({
  accounts: postgresAccounts(database),
  tokens: operatorTokens('live-identity-test-secret-'.repeat(2)),
  passwordRecovery: recovery,
  operatorManagement: postgresOperatorManagement(database, recovery.queueActivation),
  consoleAssets: await loadConsoleAssets(new URL('../web/dist/', import.meta.url)),
  ready: () => database.query('SELECT 1'),
});

// The test ingress uses the same prefix removal as Vite/nginx, without API doubles.
server.prependListener('request', (request) => {
  if (request.url?.startsWith('/api-backend/'))
    request.url = request.url.slice('/api-backend'.length);
});
server.listen(Number(process.env.BACK_OFFICE_IDENTITY_TEST_PORT ?? 8790), '127.0.0.1');
let delivery: Promise<void> | undefined;
const deliveryTimer = setInterval(() => {
  if (!delivery)
    delivery = recovery.deliver().finally(() => {
      delivery = undefined;
    });
}, 50).unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(deliveryTimer);
    server.close(() => {
      void (async () => {
        await delivery;
        await cleanupFixtures();
        await database.end();
      })();
    });
  });
