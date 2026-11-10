import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { brokerConnection, taskOptions } from './queue.ts';
import { backgroundSchedules } from './schedules.ts';
import { fullJitterBackoff } from './runtime.ts';
import { ProposalPending } from './types.ts';
import { transaction, afterCommit } from '../adapters/transaction.ts';
import type { Pool, PoolClient } from 'pg';

test('broker DB isolation, configured retry limits, integer full jitter and scheduler periods', () => {
  assert.throws(() => brokerConnection('redis://localhost/2'));
  assert.throws(() => brokerConnection('http://localhost/0'));
  assert.equal((brokerConnection('redis://localhost/0') as { db: number }).db, 0);
  assert.deepEqual(
    backgroundSchedules({}).map((item) => [item.id, item.every]),
    [
      ['sweep-governance', 120000],
      ['sweep-standing', 60000],
      ['purge-signing-intents', 3600000],
      ['purge-presentation-attributes', 300000],
      ['sweep-timestamps', 600000],
      ['revalidate-accreditation', 86400000],
    ],
  );
  assert.throws(() => backgroundSchedules({ PLR_STANDING_SWEEP_SECONDS: 'NaN' }));
  assert.equal(
    taskOptions({ operation: 'record-standing', certificateId: randomUUID() }).priority,
    1,
  );
  assert.equal(taskOptions({ operation: 'submit-timestamp', anchorId: randomUUID() }).attempts, 6);
  assert.equal(
    taskOptions({ operation: 'reconcile-governance-proposal', proposalId: randomUUID() }).attempts,
    4,
  );
  assert.deepEqual(
    taskOptions({ operation: 'reconcile-governance-proposal', proposalId: randomUUID() }).backoff,
    { type: 'fixed', delay: 120000 },
  );
  assert.equal(taskOptions({ operation: 'send-recovery', accountId: 1 }).attempts, 1);
  assert.equal(fullJitterBackoff(20, 'full-jitter', new ProposalPending()), 3000);
  assert.equal(fullJitterBackoff(21, 'full-jitter', new ProposalPending()), -1);
  assert.equal(
    fullJitterBackoff(6, 'full-jitter', new Error(), { name: 'submit-governance-signature' }),
    -1,
  );
  for (const attempt of [1, 2, 5, 20])
    for (let index = 0; index < 100; index++) {
      const delay = fullJitterBackoff(attempt, 'full-jitter', new Error());
      assert.equal(delay % 1000, 0);
      assert.ok(delay >= 0 && delay <= Math.min(600, 2 ** (attempt - 1)) * 1000);
    }
});

test('commit callbacks run after commit and release; rollback and failed commit never publish', async () => {
  for (const phase of ['success', 'work-failed', 'commit-failed']) {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql === 'COMMIT' && phase === 'commit-failed') throw new Error('commit failed');
      },
      release: () => calls.push('release'),
    } as unknown as PoolClient;
    const database = { connect: async () => client } as unknown as Pool;
    const result = transaction(database, async (connection) => {
      afterCommit(connection, async () => {
        calls.push('publish');
      });
      calls.push('decision');
      if (phase === 'work-failed') throw new Error('work failed');
      return 42;
    });
    if (phase === 'success') {
      assert.equal(await result, 42);
      assert.deepEqual(calls, ['BEGIN', 'decision', 'COMMIT', 'release', 'publish']);
    } else {
      await assert.rejects(result);
      assert.equal(calls.includes('publish'), false);
      assert.equal(calls.at(-1), 'release');
    }
  }
});
