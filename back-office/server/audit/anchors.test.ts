import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Interface, Wallet, keccak256 } from 'ethers';
import type { PoolClient } from 'pg';
import pg from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from './journal.ts';
import { postgresAnchorDelivery } from './anchor-delivery.ts';
import { postgresAnchorList } from './anchors.ts';
import { configuredTimestamp, timestampBearer } from './runtime.ts';
import type { TimestampLedger, TimestampObservation } from './timestamp-ledger.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';

test('anchor outbox persists signatures before broadcast and reconciles uncertain submissions', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const reference = 'urn:anchor-test:' + randomUUID();
  const accounts: number[] = [];
  context.after(async () => {
    try {
      await database.query('DELETE FROM operator_accounts WHERE id = ANY($1::integer[])', [
        accounts,
      ]);
    } finally {
      await database.end();
    }
  });
  const entry = await transaction(database, (client: PoolClient) =>
    appendAudit(client, { event: 'audit.preimage_disclosed', credentialId: reference }),
  );
  const {
    rows: [source],
  } = await database.query('SELECT * FROM audit_anchors WHERE entry_id = $1', [entry.id]);
  assert.equal('0x' + source.digest.toString('hex'), entry.hash);
  assert.equal(source.raw_transaction, null);
  await assert.rejects(
    transaction(database, async (client: PoolClient) => {
      await appendAudit(client, {
        event: 'audit.preimage_disclosed',
        credentialId: reference + ':rollback',
      });
      throw new Error('Rollback decision');
    }),
    /Rollback decision/,
  );
  assert.equal(
    (
      await database.query(
        `
    SELECT 1 FROM audit_anchors anchor JOIN audit_entries e ON e.id = anchor.entry_id WHERE e.credential_id = $1
  `,
        [reference + ':rollback'],
      )
    ).rowCount,
    0,
  );

  const wallet = Wallet.createRandom();
  const encoding = new Interface([
    'function commitTimestampHashes(bytes32)',
    'function timestampHashes(uint256[],bytes[],bytes[],bytes32)',
  ]);
  const observed = new Map<string, TimestampObservation>();
  const preparations = new Map<string, number>();
  const broadcasts = new Map<string, number>();
  const proof = {
    blockNumber: '100',
    blockHash: '0x' + '19'.repeat(32),
    timestamp: '2026-11-03T12:00:00.000Z',
  };
  let mode: 'fail' | 'pending' | 'confirmed' = 'fail';
  let nonce = 0;
  const ledger: TimestampLedger = {
    chainId: 1337,
    contract: '0x' + 'ab'.repeat(20),
    signerAddress: wallet.address,
    async observe(digest) {
      return observed.get(digest) ?? { state: 'missing' };
    },
    async prepare(digest) {
      preparations.set(digest, (preparations.get(digest) ?? 0) + 1);
      // The commitment and the timestamp revealing it, with consecutive nonces.
      const current = nonce;
      nonce += 2;
      const salt = '0x' + '5a'.repeat(32);
      const transaction = {
        chainId: 1337,
        to: this.contract,
        type: 0,
        gasLimit: 500_000,
        gasPrice: 0,
        value: 0,
      };
      const commitRaw = await wallet.signTransaction({
        ...transaction,
        data: encoding.encodeFunctionData('commitTimestampHashes', [keccak256(digest)]),
        nonce: current,
      });
      const raw = await wallet.signTransaction({
        ...transaction,
        data: encoding.encodeFunctionData('timestampHashes', [[0], [digest], ['0x'], salt]),
        nonce: current + 1,
      });
      return {
        raw,
        hash: keccak256(raw),
        nonce: String(current + 1),
        commitRaw,
        commitHash: keccak256(commitRaw),
      };
    },
    async broadcast(digest, signed) {
      broadcasts.set(digest, (broadcasts.get(digest) ?? 0) + 1);
      // A different connection must see the committed bytes before send.
      const {
        rows: [durable],
      } = await database.query('SELECT * FROM audit_anchors WHERE digest = $1', [
        Buffer.from(digest.slice(2), 'hex'),
      ]);
      assert.equal(durable.raw_transaction, signed.raw);
      assert.equal(durable.transaction_hash, signed.hash);
      assert.equal(String(durable.transaction_nonce), signed.nonce);
      assert.equal(durable.commit_transaction, signed.commitRaw);
      assert.equal(durable.commit_hash, signed.commitHash);
      if (mode === 'fail') throw new Error('RPC did not accept the transaction');
      observed.set(
        digest,
        mode === 'pending' ? { state: 'pending' } : { state: 'confirmed', proof },
      );
      if (mode === 'pending') throw new Error('RPC accepted the transaction but lost its response');
    },
  };
  const deliver = postgresAnchorDelivery(database, ledger);
  await deliver();
  const {
    rows: [oldest],
  } = await database.query(
    'SELECT * FROM audit_anchors WHERE confirmed_at IS NULL ORDER BY entry_id LIMIT 1',
  );
  const firstDigest = '0x' + oldest.digest.toString('hex');
  assert.equal(oldest.delivery_failed, true);
  assert.ok(oldest.raw_transaction);
  assert.equal(preparations.get(firstDigest), 1);
  assert.equal(
    (
      await database.query(
        'SELECT count(*)::integer AS total FROM audit_anchors WHERE raw_transaction IS NOT NULL',
      )
    ).rows[0].total,
    1,
  );
  const retry = () =>
    database.query(
      "UPDATE audit_anchors SET attempted_at = now() - interval '1 minute' WHERE id = $1",
      [oldest.id],
    );
  await retry();
  let switched = false;
  await postgresAnchorDelivery(database, {
    ...ledger,
    chainId: 1338,
    async observe() {
      switched = true;
      return { state: 'missing' };
    },
  })();
  assert.equal(switched, false);
  assert.equal(
    (await database.query('SELECT chain_id FROM audit_anchors WHERE id = $1', [oldest.id])).rows[0]
      .chain_id,
    '1337',
  );
  for (const sql of [
    "UPDATE audit_anchors SET digest = decode(repeat('12',32),'hex') WHERE id = $1",
    "UPDATE audit_anchors SET raw_transaction = '0x00' WHERE id = $1",
    "UPDATE audit_anchors SET contract = 'changed' WHERE id = $1",
    'DELETE FROM audit_anchors WHERE id = $1',
  ]) {
    await assert.rejects(database.query(sql, [oldest.id]), /immutable|cannot be removed/);
  }
  await assert.rejects(database.query('TRUNCATE audit_anchors'), /cannot be removed/);
  mode = 'pending';
  await retry();
  await Promise.all([deliver(), deliver()]);
  assert.equal(preparations.get(firstDigest), 1);
  assert.equal(broadcasts.get(firstDigest), 2);
  const waiting = (await database.query('SELECT * FROM audit_anchors WHERE id = $1', [oldest.id]))
    .rows[0];
  assert.equal(waiting.confirmed_at, null);
  assert.equal(waiting.delivery_failed, false);
  assert.equal(waiting.raw_transaction, oldest.raw_transaction);
  assert.equal(
    (
      await database.query(
        'SELECT count(*)::integer AS total FROM audit_anchors WHERE raw_transaction IS NOT NULL',
      )
    ).rows[0].total,
    1,
  );
  observed.set(firstDigest, { state: 'confirmed', proof });
  mode = 'confirmed';
  await retry();
  for (let count = 0; count < 30; count++) {
    await Promise.all([deliver(), deliver()]);
    const own = (
      await database.query('SELECT confirmed_at FROM audit_anchors WHERE id = $1', [source.id])
    ).rows[0];
    if (own.confirmed_at) break;
  }
  assert.ok(
    (await database.query('SELECT confirmed_at FROM audit_anchors WHERE id = $1', [source.id]))
      .rows[0].confirmed_at,
  );
  assert.equal(preparations.get(firstDigest), 1);
  assert.equal(broadcasts.get(firstDigest), 2);
  assert.equal(
    (
      await database.query(`
    SELECT 1 FROM audit_entries e JOIN audit_anchors anchor ON anchor.entry_id = e.id
    WHERE e.event IN ('audit.timestamp_anchored','audit.timestamp_failed')
  `)
    ).rowCount,
    0,
  );

  await context.test(
    'runtime privileges allow transactional enqueue without direct journal writes',
    async () => {
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'GRANT EXECUTE ON FUNCTION append_audit_event(text,integer,text,uuid,uuid,jsonb) TO pg_read_all_data',
        );
        await client.query('GRANT UPDATE ON audit_anchors TO pg_read_all_data');
        await client.query('SET LOCAL ROLE pg_read_all_data');
        const appended = await appendAudit(client, {
          event: 'audit.preimage_disclosed',
          credentialId: reference + ':role-test',
        });
        const {
          rows: [queued],
        } = await client.query('SELECT id FROM audit_anchors WHERE entry_id = $1', [appended.id]);
        assert.ok(queued);
        await client.query(
          'UPDATE audit_anchors SET attempted_at = clock_timestamp() WHERE id = $1',
          [queued.id],
        );
        await client.query('SAVEPOINT direct_write');
        await assert.rejects(
          client.query('UPDATE audit_head SET sequence = sequence'),
          /permission denied/,
        );
        await client.query('ROLLBACK TO SAVEPOINT direct_write');
        await assert.rejects(
          client.query('DELETE FROM audit_entries WHERE false'),
          /permission denied/,
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    },
  );

  for (const role of ['plr_auditor', 'plr_verifier']) {
    const {
      rows: [account],
    } = await database.query(
      `
      INSERT INTO operator_accounts (username,password_hash) VALUES ($1,'no-password') RETURNING id
    `,
      ['anchors-' + randomUUID()],
    );
    accounts.push(account.id);
    await database.query('INSERT INTO operator_roles VALUES ($1,$2)', [account.id, role]);
  }
  const tokens = operatorTokens('test-only-anchors-secret-for-api-access');
  const auditorToken = (await tokens.pair({ id: accounts[0] })).access;
  const wrongToken = (await tokens.pair({ id: accounts[1] })).access;
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    listAnchors: postgresAnchorList(database, ledger),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url =
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/registry/anchors/?credential_id=` +
    encodeURIComponent(reference);
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { headers: { authorization: 'Bearer ' + wrongToken } })).status,
    403,
  );
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + auditorToken } });
  assert.equal(response.status, 200);
  const result = (await response.json()).results[0];
  assert.equal(result.anchored, true);
  assert.equal(result.checked, true);
  assert.equal(result.digest_matches, true);
  assert.equal(result.digest, entry.hash);
  assert.equal(result.block_hash, proof.blockHash);
  assert.equal(result.proof_matches_record, true);
  assert.equal(result.raw_transaction, undefined);
  const unavailable = postgresAnchorList(database, {
    ...ledger,
    async observe() {
      throw new Error('RPC is unavailable');
    },
  });
  const unverified = (
    await unavailable(accounts[0], new URLSearchParams({ credential_id: reference }))
  ).results[0];
  assert.equal(unverified.anchored, false);
  assert.equal(unverified.checked, false);
  assert.ok(unverified.anchored_at);
  await database.query('DELETE FROM operator_roles WHERE account_id = $1', [accounts[0]]);
  assert.equal(
    (await fetch(url, { headers: { authorization: 'Bearer ' + auditorToken } })).status,
    403,
  );
});

test('timestamp bearer files rotate without caching or exposing invalid contents', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'atest-timestamp-token-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'token');
  await writeFile(path, 'header.payload.signature\n', { mode: 0o600 });
  assert.equal(await timestampBearer(path), 'header.payload.signature');
  await writeFile(path, 'rotated.payload.signature');
  assert.equal(await timestampBearer(path), 'rotated.payload.signature');
  await writeFile(path, 'secret\nmalformed');
  await assert.rejects(
    timestampBearer(path),
    (error) => error instanceof Error && !error.message.includes('secret'),
  );
  const database = new pg.Pool();
  context.after(() => database.end());
  assert.equal(
    await configuredTimestamp(database, { BACK_OFFICE_TIMESTAMP_ENABLED: 'false' }),
    undefined,
  );
  await assert.rejects(
    configuredTimestamp(database, { BACK_OFFICE_TIMESTAMP_ENABLED: 'true' }),
    /Missing timestamp settings/,
  );
});
