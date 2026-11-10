import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lifecycleFixture } from './fixtures/runtime.ts';
import { configuredIssuer } from '../issuance/runtime.ts';
import { configuredTimestamp } from '../audit/runtime.ts';
import { trustedSchemaRegistry } from '../schemas/tsr.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';

// Field material is already available in this isolated fixture; ledger, KMS, EBSI and Redis are offline. Cold KMS refusal is checked by installation acceptance.
test('lifecycle API records independent decisions with warm field keys while external dependencies are offline', async (context) => {
  const f = await lifecycleFixture();
  context.after(() => f.close());
  const dead = 'http://127.0.0.1:1';
  const runtime = await configuredIssuer(
    f.database,
    trustedSchemaRegistry(dead + '/schemas'),
    {
      BACK_OFFICE_ISSUANCE_ENABLED: 'true',
      BACK_OFFICE_PUBLIC_ORIGIN: 'https://offline.example',
      BACK_OFFICE_TOKEN_SECRET: 'offline-test-only-token-secret-value',
      AWS_REGION: 'eu-test-1',
      BACK_OFFICE_LEDGER_KMS_KEY_ID: 'offline-a',
      BACK_OFFICE_GOVERNANCE_APPROVER_KMS_KEY_ID: 'offline-b',
      BACK_OFFICE_GOVERNANCE_DEPLOYMENT_BLOCK: '0',
      PLR_KMS_ENDPOINT_URL: dead,
      PLR_LEDGER_RPC_URL: dead,
      PLR_LEDGER_CHAIN_ID: '31337',
      PLR_GOVERNANCE_CONTRACT: await f.contract.getAddress(),
      PLR_CERTIFICATE_REGISTRY: f.network.registry,
      PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL: dead + '/status',
      PLR_DIDR_URL: dead + '/did',
      PLR_TIR_URL: dead + '/tir',
      PLR_TSR_URL: dead + '/schemas',
      PLR_TRUSTED_ROOT_DIDS: 'did:ebsi:zSupport',
      DID: 'did:ebsi:zOffline',
      PLR_REDIS_CACHE_URL: 'redis://127.0.0.1:1',
    },
    undefined,
    undefined,
    f.protection,
  );
  assert.ok(runtime);
  context.after(() => runtime.close());
  const directory = await mkdtemp(join(tmpdir(), 'atest-stage5-offline-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const bearerFile = join(directory, 'timestamp-bearer');
  await writeFile(bearerFile, 'header.payload.signature');
  const timestamp = await configuredTimestamp(
    f.database,
    {
      BACK_OFFICE_TIMESTAMP_ENABLED: 'true',
      AWS_REGION: 'eu-test-1',
      PLR_KMS_ENDPOINT_URL: dead,
      BACK_OFFICE_TIMESTAMP_KMS_KEY_ID: 'offline-timestamp',
      BACK_OFFICE_TIMESTAMP_RPC_URL: dead,
      BACK_OFFICE_TIMESTAMP_CHAIN_ID: '31337',
      BACK_OFFICE_TIMESTAMP_CONTRACT: await f.contract.getAddress(),
      BACK_OFFICE_TIMESTAMP_ACCESS_TOKEN_FILE: bearerFile,
    },
    runtime.ledgerSignerAddresses,
  );
  assert.ok(timestamp);
  context.after(() => timestamp.close());
  assert.equal(timestamp.ledger.signerAddress, '', 'Timestamp key discovery must stay lazy.');
  const tokens = operatorTokens('offline-startup-session-secret-value');
  const server = backOfficeServer({
    accounts: postgresAccounts(f.database),
    tokens,
    issuer: runtime,
    statusProposals: runtime.statusProposals,
    emergencySuspend: runtime.emergencySuspend,
    listCertificates: runtime.listCertificates,
    governance: runtime.governance,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const call = async (path: string, actor: number, body?: object) => {
    const token = (await tokens.pair({ id: actor })).access;
    const response = await fetch(origin + '/registry/' + path + '/', {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('certificates', f.accounts.proposer)).body.results[0].state, 'active');
  assert.equal(
    (await call('emergency-suspend', f.accounts.proposer, { credential_id: f.credential })).status,
    200,
  );
  const proposed = await call('propose', f.accounts.proposer, {
    credential_id: f.registered,
    action: 'reinstate',
    reason_code: 'resolved',
    reason_note: 'private offline case note',
  });
  assert.equal(proposed.status, 201);
  const stored = (
    await f.database.query(
      'SELECT reason_note,reason_salt FROM certificate_status_proposals WHERE id=$1',
      [proposed.body.proposal_id],
    )
  ).rows[0];
  assert.equal(stored.reason_note.includes('private offline case note'), false);
  assert.notEqual(stored.reason_salt.length, 32);
  const listed = await call('proposals', f.accounts.proposer);
  assert.equal(listed.body.results[0].reason_note, 'private offline case note');
  assert.equal(listed.body.results[0].reason_salt, undefined);
  const approved = await call('approve', f.accounts.mixed, {
    proposal_id: proposed.body.proposal_id,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.applied, false);
  assert.equal(approved.body.state, 'suspended');
  assert.equal(
    (await call('certificates', f.accounts.proposer)).body.results[0].state,
    'suspended',
  );
});
