import { writeFile, rm } from 'node:fs/promises';
import { exportJWK } from 'jose';
import { verificationFixture } from '../server/verification/fixtures/runtime.ts';
import { actualHolderWallet } from '../server/verification/fixtures/holder-wallet.ts';
import { backOfficeServer } from '../server/http/app.ts';
import { loadConsoleAssets } from '../server/http/console.ts';
import { postgresSchemaCatalog } from '../server/schemas/catalog.ts';

const port = Number(process.env.BACK_OFFICE_VERIFICATION_TEST_PORT ?? 8794);
const fixture = await verificationFixture('http://127.0.0.1:' + port, 'browser.verification');
const good = await fixture.credential();
const suspended = await fixture.credential();
await fixture.database.query(
  `UPDATE ${fixture.table} SET record=jsonb_set(record,'{standing}','"2"') WHERE key=$1`,
  [suspended.key],
);
const wallet = await actualHolderWallet();
const exchange = wallet.create((query) => {
  void fixture.presentation(query, [good.token]).then((vp) =>
    exchange.answer({
      type: 'EnvelopedVerifiablePresentation',
      id: 'data:application/jwt,' + vp,
    }),
  );
});
const material = `/tmp/atest-verification-browser-${port}.json`;
await writeFile(
  material,
  JSON.stringify({
    token: good.token,
    suspended: suspended.token,
    holder: fixture.holder.did,
    privateJwk: await exportJWK(fixture.holder.privateKey),
    invitation: exchange.invitation,
    partyKey: fixture.firstParty.key,
    otherPartyKey: fixture.secondParty.key,
  }),
  { mode: 0o600 },
);
const server = backOfficeServer({
  accounts: fixture.accountStore,
  tokens: fixture.tokens,
  verification: fixture.verification,
  schemaCatalog: postgresSchemaCatalog(fixture.database),
  consoleAssets: await loadConsoleAssets(new URL('../web/dist/', import.meta.url)),
  ready: () => fixture.database.query('SELECT 1'),
});
server.prependListener('request', (request) => {
  if (request.url?.startsWith('/api-backend/'))
    request.url = request.url.slice('/api-backend'.length);
});
server.listen(port, '127.0.0.1');
const purge = setInterval(() => {
  void fixture.service.purgeAttributes();
}, 1000).unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close(() => {
      clearInterval(purge);
      void Promise.all([fixture.close(), wallet.close(), rm(material, { force: true })]);
    });
  });
