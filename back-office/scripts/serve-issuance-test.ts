import { issuanceFixture } from '../server/issuance/fixtures/issuance.ts';
import { backOfficeServer } from '../server/http/app.ts';
import { loadConsoleAssets } from '../server/http/console.ts';
import { postgresAccounts } from '../server/identity/auth/accounts.ts';
import { operatorTokens } from '../server/identity/auth/tokens.ts';
import { postgresIssuanceSchemes } from '../server/issuance/schemes.ts';
import { postgresCertificateList } from '../server/lifecycle/certificates.ts';

const port = Number(process.env.BACK_OFFICE_ISSUANCE_TEST_PORT ?? 8793);
const fixture = await issuanceFixture('http://127.0.0.1:' + port, 'browser.issuance');
await fixture.database.query(
  'CREATE TABLE issuance_browser_faults (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),mode text NOT NULL)',
);
await fixture.database.query("INSERT INTO issuance_browser_faults VALUES(true,'')");
// Fault controls live only in the disposable database; the HTTP API remains the
// production composition and has no test-control route or intercepted response.
fixture.state.gate = async () => {
  const {
    rows: [row],
  } = await fixture.database.query(
    "WITH prior AS MATERIALIZED (SELECT mode FROM issuance_browser_faults WHERE singleton FOR UPDATE) UPDATE issuance_browser_faults SET mode='' FROM prior WHERE singleton RETURNING prior.mode AS previous",
  );
  fixture.state.loseSignResponse = row.previous === 'lost-sign';
  fixture.state.loseLedgerResponse = row.previous === 'lost-ledger';
};
const server = backOfficeServer({
  accounts: postgresAccounts(fixture.database),
  tokens: operatorTokens('browser-issuance-only-session-secret-value'),
  issuer: fixture.issuer,
  issuanceSchemes: postgresIssuanceSchemes(fixture.database),
  listCertificates: postgresCertificateList(fixture.database, fixture.protection),
  consoleAssets: await loadConsoleAssets(new URL('../web/dist/', import.meta.url)),
  ready: () => fixture.database.query('SELECT 1'),
  reportError: () => console.error('Expected fixture provider refusal'),
});
server.prependListener('request', (request) => {
  if (request.url?.startsWith('/api-backend/'))
    request.url = request.url.slice('/api-backend'.length);
});
server.listen(port, '127.0.0.1');
let delivering = false;
const delivery = setInterval(() => {
  if (delivering) return;
  delivering = true;
  void fixture.issuer.deliverRegistrations().finally(() => {
    delivering = false;
  });
}, 100).unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    server.close(() => {
      clearInterval(delivery);
      void fixture.database.query('DROP TABLE issuance_browser_faults').then(() => fixture.close());
    }),
  );
