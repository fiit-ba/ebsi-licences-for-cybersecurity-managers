import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { Contract, JsonRpcProvider } from 'ethers';

if (
  process.env.ATEST_INSTALLATION_TEST !== 'isolated' ||
  !process.env.BACK_OFFICE_ACCEPTANCE_COMPOSE_PROJECT ||
  !process.env.BACK_OFFICE_ACCEPTANCE_COMPOSE_ENV
)
  throw new Error('Use the owned disposable installation runner.');
const state = JSON.parse(await readFile(process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE!, 'utf8'));
const compose = [
  'compose',
  '--project-name',
  process.env.BACK_OFFICE_ACCEPTANCE_COMPOSE_PROJECT,
  '--env-file',
  process.env.BACK_OFFICE_ACCEPTANCE_COMPOSE_ENV,
  '-f',
  new URL('../../infra/docker-compose.yml', import.meta.url).pathname,
];

/**
 * Control only the runner-owned Compose project, with bounded diagnostics.
 * @param args - Literal Compose arguments, never a shell command.
 * @returns Captured safe command output.
 * @throws Command failure; private application request bodies are never passed here.
 */
function docker(...args: string[]) {
  return execFileSync('docker', [...compose, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Run an isolated inspection inside the ordinary worker image.
 * @param - Authored test code; only public identifiers may be interpolated.
 * @returns Safe stdout with assertions enforced inside the container.
 * @throws Container/test failure.
 */
function inspect(source: string) {
  return docker('exec', '-T', 'worker', 'node', '--input-type=module', '-e', source);
}

/**
 * Call an existing API operation without logging its authorization material.
 * @param path - Existing route.
 * @param token - Existing actor bearer.
 * @param body - Optional POST body.
 * @param status - Expected status.
 * @returns Parsed response.
 * @throws Assertion for an unexpected response.
 */
async function api(path: string, token = '', body?: unknown, status = 200) {
  const response = await fetch(state.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}

const provider = new JsonRpcProvider(process.env.BACK_OFFICE_ACCEPTANCE_RPC_URL);
try {
  const root = (
    await api('/api/api-token-auth', '', { username: state.username, password: state.password })
  ).access;
  const options = await api('/admin/accounts/options/', root);
  const groups = Object.fromEntries(
    options.groups.map((group: { name: string; id: number }) => [group.name, group.id]),
  );
  const actors = [];
  for (let index = 0; index < 2; index++) {
    const username = 'background.' + randomUUID().slice(0, 8);
    await api(
      '/admin/accounts/',
      root,
      {
        username,
        email: username + '@example.test',
        password: state.password,
        active: true,
        first_name: '',
        last_name: '',
        is_staff: false,
        is_superuser: false,
        group_ids: [groups.plr_status_manager],
        permission_ids: [],
      },
      201,
    );
    actors.push(
      (await api('/api/api-token-auth', '', { username, password: state.password })).access,
    );
  }
  const credential = (decodeJwt(state.credential.split('~')[0]).vc as { id: string }).id;
  const id = docker('ps', '-q', 'worker');
  // Remove only test-owned scheduler keys, simulating missing broker scheduling metadata.
  inspect(
    `import {backgroundQueue} from './server/background/queue.ts';const q=backgroundQueue(process.env.REDIS_BROKER_URL);try{for(const s of await q.getJobSchedulers())await q.removeJobScheduler(s.key);}finally{await q.close();}`,
  );
  docker('stop', 'redis');
  const proposed = await api(
    '/registry/propose/',
    actors[0],
    {
      credential_id: credential,
      action: 'suspend',
      reason_code: 'issued_in_error',
      reason_note: 'Isolated broker outage test',
    },
    201,
  );
  await api('/registry/approve/', actors[1], { proposal_id: proposed.proposal_id });
  const pending = JSON.parse(
    inspect(
      `import pg from 'pg';const d=new pg.Pool();try{console.log(JSON.stringify((await d.query('SELECT applied_at,onchain_proposal_id FROM certificate_status_proposals WHERE id=$1',['${proposed.proposal_id}'])).rows[0]));}finally{await d.end();}`,
    ),
  );
  assert.equal(pending.applied_at, null);
  assert.equal(pending.onchain_proposal_id, null);
  docker('stop', 'backend');
  assert.equal(docker('ps', '-q', 'worker'), id, 'Stopping API stopped or replaced worker.');
  docker('up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'redis');
  // Wait for the scheduled database safety sweep, using the configured test interval.
  inspect(
    `import pg from 'pg';const d=new pg.Pool();try{let complete=false;for(let i=0;i<150;i++){const r=(await d.query('SELECT applied_at FROM certificate_status_proposals WHERE id=$1',['${proposed.proposal_id}'])).rows[0];if(r.applied_at){complete=true;break;}await new Promise(r=>setTimeout(r,200));}if(!complete)throw new Error('Scheduled recovery did not execute the committed case.');}finally{await d.end();}`,
  );
  assert.equal(docker('ps', '-q', 'worker'), id, 'Redis recovery replaced worker.');
  inspect(
    `import {backgroundQueue} from './server/background/queue.ts';const q=backgroundQueue(process.env.REDIS_BROKER_URL);try{if(await q.getJobSchedulersCount()!==6)throw new Error('Schedules not restored.');}finally{await q.close();}`,
  );
  const deployment = JSON.parse(
    inspect(
      `import pg from 'pg';const d=new pg.Pool();try{console.log(JSON.stringify({contract:process.env.PLR_CERTIFICATE_REGISTRY,key:(await d.query("SELECT encode(status_key,'hex') AS key FROM registered_certificates WHERE id=$1",['${state.certificate_id}'])).rows[0].key}));}finally{await d.end();}`,
    ),
  );
  const ledger = new Contract(
    deployment.contract,
    [
      // The certificate registry keeps each collected certificate's record.
      'function certificateStatus(bytes32) view returns (tuple(uint8 standing,uint64 validFrom,uint64 validUntil,uint64 registeredAt,uint64 changedAt,bytes32 credentialHash,string issuerDid))',
    ],
    provider,
  );
  assert.equal((await ledger.certificateStatus('0x' + deployment.key)).standing, 2n);
  const signatures = inspect(
    `import pg from 'pg';const d=new pg.Pool();try{console.log((await d.query('SELECT count(*) FROM ledger_signing_intents WHERE consumed_at IS NOT NULL')).rows[0].count);}finally{await d.end();}`,
  );
  docker('restart', 'worker');
  docker('up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'worker');
  inspect(
    `import {backgroundQueue,enqueue} from './server/background/queue.ts';const q=backgroundQueue(process.env.REDIS_BROKER_URL);try{for(let i=0;i<2;i++)await enqueue(q,{operation:'reconcile-governance-proposal',proposalId:'${proposed.proposal_id}'});for(let i=0;i<100;i++){if(await q.getActiveCount()===0 && await q.getPrioritizedCount()===0)break;await new Promise(r=>setTimeout(r,100));}if(await q.getJobSchedulersCount()!==6)throw new Error('Duplicate schedules.');}finally{await q.close();}`,
  );
  assert.equal(
    inspect(
      `import pg from 'pg';const d=new pg.Pool();try{console.log((await d.query('SELECT count(*) FROM ledger_signing_intents WHERE consumed_at IS NOT NULL')).rows[0].count);}finally{await d.end();}`,
    ),
    signatures,
  );
  docker('up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'backend');
  const current = async () =>
    (await api('/registry/certificates/', actors[0])).results.find(
      (row: { credential_id: string }) => row.credential_id === credential,
    );
  assert.equal((await current()).state, 'suspended');
  const reinstatement = await api(
    '/registry/propose/',
    actors[0],
    { credential_id: credential, action: 'reinstate', reason_code: 'issued_in_error' },
    201,
  );
  await api('/registry/approve/', actors[1], { proposal_id: reinstatement.proposal_id });
  let active = false;
  for (let index = 0; index < 100; index++) {
    if ((await current()).state === 'active') {
      active = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(active, 'Reinstatement after API/worker restart did not finish.');
  assert.equal((await ledger.certificateStatus('0x' + deployment.key)).standing, 1n);
  const redis = docker('exec', '-T', 'redis', 'redis-cli', 'CONFIG', 'GET', 'appendonly', 'save');
  assert.match(redis, /appendonly\s+no/);
  assert.ok(
    redis
      .split(/\r?\n/)
      .find((value, index, values) => values[index - 1] === 'save' && value.trim().length > 0),
    'Local Redis must retain default snapshot configuration.',
  );
  console.log(
    'API stop, independent worker, broker outage with committed decisions, automatic schedule/DB recovery, worker restart/redelivery and Redis local defaults passed.',
  );
} finally {
  provider.destroy();
}
