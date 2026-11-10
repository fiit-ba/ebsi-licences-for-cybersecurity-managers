import { createServer } from 'node:http';
import { lifecycleFixture } from '../server/lifecycle/fixtures/runtime.ts';
import { backOfficeServer } from '../server/http/app.ts';
import { loadConsoleAssets } from '../server/http/console.ts';
import { postgresAccounts } from '../server/identity/auth/accounts.ts';
import { operatorTokens } from '../server/identity/auth/tokens.ts';
import { postgresCertificateList } from '../server/lifecycle/certificates.ts';
import { postgresStatusProposals } from '../server/lifecycle/proposals.ts';
import { postgresEmergencySuspension } from '../server/lifecycle/emergency.ts';
import { postgresNotifications } from '../server/lifecycle/notifications.ts';
import { postgresAudit } from '../server/audit/service.ts';
import { postgresDecisionAnchors } from '../server/audit/decisions.ts';
import pg from 'pg';

const fixture = await lifecycleFixture('browser.lifecycle');
// Normal reads use live views. The negative browser case replaces these with
// damaged fixture copies; immutable public history is never edited or erased.
await fixture.database.query(`CREATE SCHEMA stage5_browser_audit;
  CREATE VIEW stage5_browser_audit.audit_entries AS SELECT * FROM public.audit_entries;
  CREATE VIEW stage5_browser_audit.audit_head AS SELECT * FROM public.audit_head`);
const auditDatabase = new pg.Pool({ options: '-c search_path=stage5_browser_audit,public' });
const inner = backOfficeServer({
  accounts: postgresAccounts(fixture.database),
  tokens: operatorTokens('browser-stage5-only-session-secret-value'),
  statusProposals: postgresStatusProposals(fixture.database, { protection: fixture.protection }),
  governance: fixture.governance,
  governanceProfile: { contract: await fixture.contract.getAddress(), consoleRoles: ['A', 'B'] },
  listCertificates: postgresCertificateList(fixture.database, fixture.protection),
  emergencySuspend: postgresEmergencySuspension(fixture.database, {
    protection: fixture.protection,
  }),
  notifications: postgresNotifications(fixture.database, fixture.protection),
  audit: postgresAudit(auditDatabase, fixture.protection),
  listAnchors: postgresDecisionAnchors(fixture.database, fixture.protection),
  consoleAssets: await loadConsoleAssets(new URL('../web/dist/', import.meta.url)),
  ready: () => fixture.database.query('SELECT 1'),
});
// This listener is a real JSON-RPC transport to the test run's anvil ledger.
// Browser requests and checked API responses are never intercepted.
const server = createServer(async (request, response) => {
  if (request.url === '/api-ledger' && request.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 1000000) throw new Error('Oversized test RPC request.');
      }
      const input = JSON.parse(body);
      const execute = async (item: { id: number; method: string; params?: unknown[] }) => {
        try {
          return {
            id: item.id,
            jsonrpc: '2.0',
            result: await fixture.network.provider.send(item.method, item.params ?? []),
          };
        } catch (error) {
          return {
            id: item.id,
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      };
      const result = Array.isArray(input)
        ? await Promise.all(input.map(execute))
        : await execute(input);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(400).end();
    }
    return;
  }
  if (request.url?.startsWith('/api-backend/'))
    request.url = request.url.slice('/api-backend'.length);
  inner.emit('request', request, response);
});
server.listen(Number(process.env.BACK_OFFICE_LIFECYCLE_TEST_PORT ?? 8795), '127.0.0.1');
let running = false;
const work = setInterval(() => {
  if (running) return;
  running = true;
  void fixture
    .deliverEmergencies()
    .then(() => fixture.deliver())
    .finally(() => {
      running = false;
    });
}, 150).unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(work);
    server.close(() => {
      void auditDatabase
        .end()
        .then(() => fixture.database.query('DROP SCHEMA stage5_browser_audit CASCADE'))
        .finally(() => fixture.close());
    });
  });
