import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Wallet, Interface, keccak256 } from 'ethers';
import { lifecycleFixture } from '../lifecycle/fixtures/runtime.ts';
import { anchorDecision, decisionDigest, postgresDecisionAnchors } from './decisions.ts';
import { postgresAnchorDelivery } from './anchor-delivery.ts';
import { transaction } from '../adapters/transaction.ts';
import type { TimestampLedger, TimestampProof } from './timestamp-ledger.ts';

// A separate disposable database avoids changing the full suite's immutable audit fixtures.
test('encrypted decision snapshots, actual digest evidence and durable timestamp retries', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const name = 'atest_decision_' + randomUUID().replaceAll('-', '');
  const control = new pg.Pool();
  let created = false;
  let fixture: Awaited<ReturnType<typeof lifecycleFixture>> | undefined;
  context.after(async () => {
    try {
      await fixture?.close();
      if (created) await control.query('DROP DATABASE ' + name);
    } finally {
      await control.end();
    }
  });
  await control.query('CREATE DATABASE ' + name);
  created = true;
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../../data/migrate.ts', import.meta.url))],
    { env: { ...process.env, PGDATABASE: name }, stdio: 'pipe' },
  );
  fixture = await lifecycleFixture(
    'decision-source-' + randomUUID(),
    new pg.Pool({ database: name }),
  );
  const f = fixture;
  const snapshot = {
    certificate: f.certificate,
    credential_id: f.credential,
    holder_reference: 'private decision holder',
    claims: { holderName: 'Žofia 😀', n: 42 },
    decided_at: new Date('2026-11-04T10:00:00.123Z'),
  };
  const id = await transaction(f.database, (client) =>
    anchorDecision(client, f.protection, {
      kind: 'issuance',
      certificate: f.certificate,
      credentialId: f.credential,
      decision: snapshot,
    }),
  );
  const row = (await f.database.query('SELECT * FROM decision_anchors WHERE id=$1', [id])).rows[0];
  assert.equal(row.decision_encrypted.includes(Buffer.from('private decision holder')), false);
  const decoded = f.protection.open(id, row.decision_encrypted);
  assert.equal(decoded.decided_at, '2026-11-04 10:00:00.123000+00:00');
  assert.equal(decisionDigest(decoded), row.digest.toString('hex'));
  const wallet = Wallet.createRandom();
  const abi = new Interface([
    'function commitTimestampHashes(bytes32)',
    'function timestampHashes(uint256[],bytes[],bytes[],bytes32)',
  ]);
  const confirmed = new Map<string, TimestampProof>();
  let preparations = 0;
  let broadcasts = 0;
  let loseResponse = true;
  let nonce = 0;
  const ledger: TimestampLedger = {
    chainId: 1337,
    contract: '0x' + 'ab'.repeat(20),
    signerAddress: wallet.address,
    async observe(digest) {
      return confirmed.has(digest)
        ? { state: 'confirmed', proof: confirmed.get(digest)! }
        : { state: 'missing' };
    },
    // The commitment and the timestamp revealing it, signed together with consecutive nonces.
    async prepare(digest) {
      preparations++;
      const transaction = {
        chainId: 1337,
        to: this.contract,
        type: 0,
        gasLimit: 500000,
        gasPrice: 0,
        value: 0,
      };
      const commitRaw = await wallet.signTransaction({
        ...transaction,
        nonce: nonce++,
        data: abi.encodeFunctionData('commitTimestampHashes', [keccak256(digest)]),
      });
      const raw = await wallet.signTransaction({
        ...transaction,
        nonce: nonce++,
        data: abi.encodeFunctionData('timestampHashes', [
          [0],
          [digest],
          ['0x'],
          '0x' + '5a'.repeat(32),
        ]),
      });
      return {
        raw,
        hash: keccak256(raw),
        nonce: String(nonce - 1),
        commitRaw,
        commitHash: keccak256(commitRaw),
      };
    },
    async broadcast(digest, signed) {
      broadcasts++;
      assert.equal(keccak256(signed.raw), signed.hash);
      assert.equal(keccak256(signed.commitRaw), signed.commitHash);
      confirmed.set(digest, {
        blockNumber: String(100 + broadcasts),
        blockHash: '0x' + '19'.repeat(32),
        timestamp: '2026-11-04T10:01:00.000Z',
      });
      if (loseResponse) {
        loseResponse = false;
        throw new Error('The timestamp response was lost after mining.');
      }
    },
  };
  const worker = postgresAnchorDelivery(f.database, ledger, f.protection);
  await worker();
  await f.database.query('UPDATE audit_anchors SET attempted_at=NULL WHERE confirmed_at IS NULL');
  await postgresAnchorDelivery(f.database, ledger, f.protection)();
  const count = preparations;
  await worker();
  assert.equal(preparations, count, 'Restart/retry must retain signed bytes and nonce.');
  const listed = await postgresDecisionAnchors(
    f.database,
    f.protection,
    ledger,
  )(f.accounts.auditor, new URLSearchParams({ credential_id: f.registered }));
  assert.equal(listed.results.length, 1);
  assert.equal(listed.results[0].kind, 'issuance');
  assert.equal(listed.results[0].anchored, true);
  assert.equal(listed.results[0].digest_matches, true);
  assert.ok(listed.results[0].transaction_hash);
  assert.equal(JSON.stringify(listed).includes('private decision holder'), false);
  await f.database.query('UPDATE decision_anchors SET decision_encrypted=$2 WHERE id=$1', [
    id,
    f.protection.seal(id, { changed: true }),
  ]);
  const altered = await postgresDecisionAnchors(
    f.database,
    f.protection,
    ledger,
  )(f.accounts.auditor, new URLSearchParams({ credential_id: f.credential }));
  assert.equal(altered.results[0].digest_matches, false);
  assert.equal(
    altered.results[0].anchored,
    true,
    'Ledger inclusion and local snapshot integrity are independent evidence checks.',
  );
  await assert.rejects(
    postgresDecisionAnchors(
      f.database,
      f.protection,
      ledger,
    )(f.accounts.second, new URLSearchParams({ credential_id: f.credential })),
  );
  await context.test(
    'configured retry budget stops unsigned work while persisted uncertain bytes remain recoverable',
    async () => {
      const retry = await transaction(f.database, (client) =>
        anchorDecision(client, f.protection, {
          kind: 'issuance',
          certificate: f.certificate,
          credentialId: f.credential,
          decision: { ...snapshot, holder_reference: 'retry-budget-fixture' },
        }),
      );
      await f.database.query('UPDATE audit_anchors SET attempts=49 WHERE decision_id=$1', [retry]);
      let failures = 0;
      const unavailable: TimestampLedger = {
        ...ledger,
        async prepare() {
          failures++;
          throw new Error('KMS unavailable before retained signature');
        },
      };
      await postgresAnchorDelivery(f.database, unavailable, f.protection)();
      await f.database.query('UPDATE audit_anchors SET attempted_at=NULL WHERE decision_id=$1', [
        retry,
      ]);
      await postgresAnchorDelivery(f.database, unavailable, f.protection)();
      const stopped = (
        await f.database.query(
          'SELECT attempts,raw_transaction FROM audit_anchors WHERE decision_id=$1',
          [retry],
        )
      ).rows[0];
      assert.equal(stopped.attempts, 50);
      assert.equal(stopped.raw_transaction, null);
      assert.equal(
        failures,
        1,
        'The timestamp sweep does not automatically restart unsigned work after 50 attempts',
      );

      // Fixture-only scheduling models explicit technical recovery; immutable evidence is untouched.
      await f.database.query(
        'UPDATE audit_anchors SET attempts=49,attempted_at=NULL WHERE decision_id=$1',
        [retry],
      );
      await postgresAnchorDelivery(
        f.database,
        {
          ...ledger,
          async broadcast() {
            throw new Error('Submission outcome unknown after retaining exact bytes');
          },
        },
        f.protection,
      )();
      const uncertain = (
        await f.database.query(
          'SELECT attempts,raw_transaction,transaction_hash FROM audit_anchors WHERE decision_id=$1',
          [retry],
        )
      ).rows[0];
      assert.equal(uncertain.attempts, 50);
      assert.ok(uncertain.raw_transaction);
      const signatures = preparations;
      await f.database.query('UPDATE audit_anchors SET attempted_at=NULL WHERE decision_id=$1', [
        retry,
      ]);
      await postgresAnchorDelivery(f.database, ledger, f.protection)();
      assert.equal(
        preparations,
        signatures,
        'No new signature is allocated for an uncertain retained nonce',
      );
      const recovered = (
        await f.database.query(
          'SELECT confirmed_at,raw_transaction,transaction_hash FROM audit_anchors WHERE decision_id=$1',
          [retry],
        )
      ).rows[0];
      assert.ok(recovered.confirmed_at);
      assert.equal(recovered.raw_transaction, uncertain.raw_transaction);
      assert.equal(recovered.transaction_hash, uncertain.transaction_hash);
    },
  );
});
