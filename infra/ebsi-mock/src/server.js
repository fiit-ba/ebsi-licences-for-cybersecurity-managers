// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * EBSI's Core API v1 for local development (component 3), over EBSI's own
 * registry contracts deployed on the development ledger
 * (contracts/local/ebsi-mock, contracts/scripts/DeployEBSI.s.sol).
 *
 *   /v1/did-registry      DID documents                    (registries.js)
 *   /v1/issuers-registry  accreditations                   (registries.js)
 *   /v1/schemas-registry  credential schemas               (registries.js)
 *   /v1/timestamp         timestamps                       (registries.js)
 *   /v1/auth              OpenID4VP 1.0 + DCQL tokens      (auth.js)
 *   /v1/ledger            JSON-RPC, scoped writes          (ledger.js)
 *   /__mock/...           the Support Office's own acts    (support-office.js)
 *   /__mock/seed ...      trust chains for tests           (fixtures.js)
 *
 * The chain is the only state, so a restart loses nothing. This is a
 * development fixture: its operator and Support Office keys are public
 * development keys, and it refuses to run on any chain but a development one.
 */

import express from 'express';
import {authorisation} from './auth.js';
import {connectChain} from './chain.js';
import {readConfig} from './config.js';
import {fixturesRouter} from './fixtures.js';
import {ledgerRouter} from './ledger.js';
import {problem, registriesRouter} from './registries.js';
import {supportOffice} from './support-office.js';

const config = readConfig();
const log = (...args) => {
  if (!config.quiet) console.log('[ebsi-mock]', ...args);
};

const chain = connectChain(config);
const office = supportOffice(config, chain);
const auth = authorisation(config, chain, office);

let ready = false;
const app = express();
app.disable('x-powered-by');

// EBSI's read APIs are public; a browser may read them.
app.use((req, res, next) => {
  res.set('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('access-control-allow-headers', 'authorization, content-type, accept');
    res.set('access-control-allow-methods', 'GET, POST');
    return res.status(204).end();
  }
  next();
});

app.get('/health', (_req, res) => (ready ? res.json({status: 'ok'}) : res.status(503).json({status: 'starting'})));
app.use((req, res, next) => (ready || req.path === '/health' ? next() : problem(res, 503, undefined, 'Service Unavailable', 'Starting')));

app.use(registriesRouter(chain, config));
app.use(auth.router);
app.use(ledgerRouter(config, chain, auth.verifyToken));
app.use(express.json({limit: '2mb'}), office.router);
app.use(fixturesRouter(config, chain, office));

app.use((_req, res) => problem(res, 404, undefined, 'Not Found'));

// A body that is not JSON is a JSON-RPC parse error on the Ledger API and a
// plain 400 elsewhere; anything else is this service's or the ledger's fault.
app.use((error, req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    if (req.path === '/v1/ledger') return res.status(400).json({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'parse error'}});
    return problem(res, 400, undefined, 'Bad Request', 'The body is not valid JSON');
  }
  log('error', req.method, req.path, error?.shortMessage ?? error?.message ?? error);
  return problem(res, 502, 'ledger-error', 'Bad Gateway', String(error?.shortMessage ?? error?.message ?? error).slice(0, 300));
});

/** Wait for the ledger and EBSI's contracts, then set up what a development chain lacks. */
async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await chain.ensureGenesis(office.assertion);
      break;
    } catch (error) {
      if (attempt % 10 === 1) log('waiting for the ledger and EBSI contracts:', error?.shortMessage ?? error?.message ?? error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  ready = true;
  log(`ready: Support Office ${office.did} (${chain.supportOffice.address}), operator ${chain.admin.address}`);
  log('registries', JSON.stringify(config.contracts));
  log('trusted contracts', config.invoke.join(', ') || '(none)');
}

app.listen(config.port, () => log(`listening on ${config.port}, public at ${config.base}`));
start();
