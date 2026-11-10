import pg from 'pg';
import { backOfficeServer } from '../server/http/app.ts';
import { loadConsoleAssets } from '../server/http/console.ts';
import { postgresAccounts } from '../server/identity/auth/accounts.ts';
import { operatorTokens } from '../server/identity/auth/tokens.ts';
import { hashPassword } from '../server/identity/auth/passwords.ts';
import { postgresInvitations } from '../server/accreditation/invitations.ts';
import { postgresTrustChain } from '../server/accreditation/chain.ts';
import { postgresRegistrationThrottle } from '../server/accreditation/registration-throttle.ts';
import { postgresSchemaCatalog } from '../server/schemas/catalog.ts';
import { postgresIssuanceSchemes } from '../server/issuance/schemes.ts';
import { postgresNotifications } from '../server/lifecycle/notifications.ts';
import { configuredOrganizations } from '../server/accreditation/runtime.ts';
import { postgresSchemaManagement } from '../server/schemas/management.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';
import { kmsHttpFixture } from '../server/keys/fixtures/kms-http.ts';
import { testLedger } from '../server/lifecycle/fixtures/ledger.ts';

if (process.env.PGDATABASE !== 'atest_back_office_test')
  throw new Error(
    'Organization browser checks require the disposable atest_back_office_test database.',
  );
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const usernames = ['browser.organization.root', 'browser.organization.observer'];
const credentialType = 'OrganizationBrowserCredential';
const publishedType = 'BrowserPublishedCertificate';

/**
 * Remove this fixture's hierarchy, accounts and schema without modifying other domains' fixtures.
 * @returns Completion after the synthetic hierarchy and its role memberships are removed.
 * @throws Database errors; immutable journal evidence is intentionally retained.
 */
async function cleanup(): Promise<void> {
  const rows = (
    await database.query<{ id: string; account_id: number | null }>(
      `WITH RECURSIVE scope AS (
    SELECT o.id,o.account_id FROM accredited_organizations o JOIN operator_accounts a ON a.id=o.account_id WHERE a.username=$1
    UNION ALL SELECT o.id,o.account_id FROM accredited_organizations o JOIN scope p ON o.parent_id=p.id
  ) SELECT * FROM scope`,
      [usernames[0]],
    )
  ).rows;
  const organizations = rows.map((row) => row.id);
  const accounts = rows.flatMap((row) => (row.account_id === null ? [] : [row.account_id]));
  await database.query(
    'DELETE FROM accreditation_withdrawals WHERE revoked_organization_id=ANY($1::uuid[])',
    [organizations],
  );
  await database.query(
    'DELETE FROM organization_key_requests WHERE organization_id=ANY($1::uuid[])',
    [organizations],
  );
  await database.query('DELETE FROM signing_key_provisions WHERE organization_id=ANY($1::uuid[])', [
    organizations,
  ]);
  await database.query('DELETE FROM issuer_signing_keys WHERE organization_id=ANY($1::uuid[])', [
    organizations,
  ]);
  await database.query('DELETE FROM accreditation_events WHERE organization_id=ANY($1::uuid[])', [
    organizations,
  ]);
  await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
    organizations,
  ]);
  await database.query(
    'DELETE FROM operator_accounts WHERE id=ANY($1::integer[]) OR username=ANY($2::text[])',
    [accounts, usernames],
  );
  await database.query(
    'DELETE FROM certificate_schema_versions WHERE schema_id IN (SELECT id FROM certificate_schemas WHERE credential_type=ANY($1::text[]))',
    [[credentialType, publishedType]],
  );
  await database.query('DELETE FROM schema_events WHERE credential_type=ANY($1::text[])', [
    [credentialType, publishedType],
  ]);
  await database.query('DELETE FROM certificate_schemas WHERE credential_type=ANY($1::text[])', [
    [credentialType, publishedType],
  ]);
  await database.query(`DELETE FROM operator_groups WHERE name IN ('plr_tao','plr_issuer','plr_status_manager','plr_verifier')
    AND NOT EXISTS (SELECT 1 FROM operator_account_groups m WHERE m.group_id=operator_groups.id)`);
}
await cleanup();
const hash = await hashPassword('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
for (const username of usernames) {
  const account = (
    await database.query<{ id: number }>(
      'INSERT INTO operator_accounts(username,password_hash,is_staff,is_superuser) VALUES ($1,$2,$3,$3) RETURNING id',
      [username, hash, username === usernames[1]],
    )
  ).rows[0];
  await database.query("INSERT INTO operator_roles VALUES ($1,'plr_rtao')", [account.id]);
  if (username === usernames[0])
    await database.query(
      "INSERT INTO accredited_organizations(name,kind,account_id) VALUES ('Browser Root Authority','rtao',$1)",
      [account.id],
    );
}
const schema = (
  await database.query<{ id: string }>(
    'INSERT INTO certificate_schemas(credential_type,name_sk,name_en) VALUES ($1,$2,$3) RETURNING id',
    [credentialType, 'Organizačné oprávnenie', 'Organization credential'],
  )
).rows[0];
await database.query(
  `INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES ($1,1,$2,'organization-browser-fixture',clock_timestamp())`,
  [
    schema.id,
    JSON.stringify([
      {
        key: 'certificate_number',
        kind: 'text',
        section: 'body',
        label: { sk: 'Číslo', en: 'Number' },
        hint: { sk: '', en: '' },
        organization: false,
        required: true,
        default: '',
      },
    ]),
  ],
);
// The development EBSI service (with the test ledger it runs over) is optional for the
// registration-only suite. KMS is an in-memory EC fixture behind the AWS protocol; no mail
// transport is composed.
const mock = process.env.BACK_OFFICE_TEST_EBSI_URL;
const schemas = trustedSchemaRegistry((mock ?? 'https://tsr.example') + '/v1/schemas-registry');
const kms = mock ? await kmsHttpFixture() : undefined;
// AWS clients read credentials from the process, as in production.
process.env.AWS_ACCESS_KEY_ID = 'fixture-only';
process.env.AWS_SECRET_ACCESS_KEY = 'fixture-only';
const organizations =
  mock && kms
    ? configuredOrganizations(database, schemas, {
        DID: 'did:ebsi:zBrowserRegistry',
        PLR_EBSI_MOCK_URL: mock,
        PLR_EBSI_URL: mock,
        PLR_TIR_URL: mock + '/v1/issuers-registry',
        PLR_DIDR_URL: mock + '/v1/did-registry/identifiers',
        PLR_TRUSTED_ROOT_DIDS: 'did:ebsi:zSupport',
        PLR_LEDGER_RPC_URL: mock + '/v1/ledger',
        PLR_LEDGER_CHAIN_ID: String((await testLedger()).chainId),
        AWS_REGION: 'eu-central-1',
        PLR_KMS_ENDPOINT_URL: kms.origin,
      })
    : undefined;
// The test ledger mines at once; look for receipts often rather than every second.
if (organizations?.ebsi) organizations.ebsi.provider.pollingInterval = 200;
const secret = 'organization-browser-only-test-secret-'.repeat(2);
const server = backOfficeServer({
  accounts: postgresAccounts(database),
  tokens: operatorTokens(secret),
  // No worker runs here: a registered TI is onboarded within its registration.
  invitations: postgresInvitations(
    database,
    organizations
      ? {
          onboard: organizations.onboarding.onboard,
          refresh: organizations.onboarding.refresh,
          withdraw: organizations.withdrawals.deliver,
          governanceEnabled: false,
        }
      : {},
  ),
  schemaManagement: postgresSchemaManagement(database, schemas, {
    publish: organizations?.schemaOptions.publish,
  }),
  trustChain: postgresTrustChain(database),
  notifications: postgresNotifications(database),
  schemaCatalog: postgresSchemaCatalog(database),
  issuanceSchemes: postgresIssuanceSchemes(database),
  registrationThrottle: postgresRegistrationThrottle(database, secret, '100/hour'),
  consoleAssets: await loadConsoleAssets(new URL('../web/dist/', import.meta.url)),
  ready: () => database.query('SELECT 1'),
});
server.prependListener('request', (request) => {
  if (request.url?.startsWith('/api-backend/'))
    request.url = request.url.slice('/api-backend'.length);
});
server.listen(Number(process.env.BACK_OFFICE_ORGANIZATION_TEST_PORT ?? 8791), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close(() => {
      organizations?.close();
      void cleanup().finally(() => Promise.all([database.end(), kms?.close()]));
    });
  });
