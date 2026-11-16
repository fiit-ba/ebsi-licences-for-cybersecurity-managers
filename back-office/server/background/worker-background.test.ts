import assert from 'node:assert/strict';
import { createClient } from 'redis';
import type { Pool } from 'pg';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { backgroundQueue, enqueue, enqueueCommitted, queuePrefix } from './queue.ts';
import { backgroundRuntime } from './runtime.ts';
import { registerSchedules } from './schedules.ts';
import { backgroundHandlers } from './handlers.ts';
import { lifecycleFixture } from '../lifecycle/fixtures/runtime.ts';
import { postgresStatusProposals } from '../lifecycle/proposals.ts';
import type { Domains } from '../runtime.ts';
import type { BackgroundTask } from './types.ts';

const url = process.env.BACK_OFFICE_TEST_BROKER_URL;

/** Wait for an actual asynchronous condition with a bounded failure. */
async function until(check: () => Promise<boolean> | boolean, label: string) {
  for (let index = 0; index < 400; index++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error('Timed out: ' + label);
}

test(
  'real Redis priority, duplicate schedules, stalled recovery and independent ledger processing',
  { skip: !url, timeout: 90000 },
  async (context) => {
    const queue = backgroundQueue(url!);
    await queue.waitUntilReady();
    await queue.obliterate({ force: true });
    context.after(async () => {
      await queue.obliterate({ force: true });
      await queue.close();
    });
    const f = await lifecycleFixture();
    context.after(() => f.close());
    const domains = {
      issuer: {
        deliverApprovedCases: f.deliver,
        deliverRegistrations: async () => 0,
        deliverEmergencySuspensions: f.deliverEmergencies,
        refreshStanding: async () => {},
        governance: f.governance,
        verification: { purgeAttributes: async () => 0 },
      },
      organizations: {
        withdrawals: { deliver: async () => {} },
        accreditation: { revalidateAll: async () => [] },
      },
    } as unknown as Domains;
    const handle = backgroundHandlers(f.database, domains, queue);
    const proposals = postgresStatusProposals(f.database, { protection: f.protection });
    const priorUrl = process.env.REDIS_BROKER_URL;
    context.after(() => {
      if (priorUrl === undefined) delete process.env.REDIS_BROKER_URL;
      else process.env.REDIS_BROKER_URL = priorUrl;
    });

    await context.test(
      'broker outage preserves committed decision, then sweep recovers it',
      async () => {
        process.env.REDIS_BROKER_URL = 'redis://127.0.0.1:1/0';
        const start = Date.now();
        const opened = await proposals.propose(f.accounts.proposer, {
          credential_id: f.registered,
          action: 'suspend',
          reason_code: 'issued_in_error',
        });
        assert.ok(Date.now() - start < 6000, 'Broker failure must be bounded.');
        const row = (
          await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
            opened.proposal_id,
          ])
        ).rows[0];
        assert.equal(row.onchain_proposal_id, null);
        assert.equal(row.proposed_by, f.accounts.proposer);
        delete process.env.REDIS_BROKER_URL;
        await proposals.decide(f.accounts.mixed, opened.proposal_id, 'approved');
        await handle({ operation: 'sweep-governance' });
        const queued = await queue.getJobs(['prioritized']);
        assert.ok(
          queued.some(
            (job) =>
              job.data.operation === 'submit-governance-proposal' &&
              'proposalId' in job.data &&
              job.data.proposalId === opened.proposal_id,
          ),
        );
        await queue.drain();

        // A genuine worker claims the task. Actual unchanged Solidity execution occurs before its acknowledgement.
        const child = fork(new URL('./fixtures/crash-worker.ts', import.meta.url), [], {
          env: { ...process.env, BACK_OFFICE_TEST_BROKER_URL: url },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        context.after(() => {
          if (!child.killed) child.kill('SIGKILL');
        });
        let ready = false;
        let claimed = false;
        child.on('message', (message) => {
          if (message === 'ready') ready = true;
          else if ((message as BackgroundTask).operation === 'submit-governance-proposal')
            claimed = true;
        });
        await until(() => ready, 'crash worker ready');
        const job = await enqueue(queue, {
          operation: 'submit-governance-proposal',
          proposalId: opened.proposal_id,
        });
        await until(() => claimed, 'worker claimed concrete case');
        await f.deliver(opened.proposal_id);
        assert.equal(
          (
            await f.database.query(
              'SELECT onchain_state FROM certificate_status_proposals WHERE id=$1',
              [opened.proposal_id],
            )
          ).rows[0].onchain_state,
          'executed',
        );
        const signatures = (
          await f.database.query(
            'SELECT count(*) FROM ledger_signing_intents WHERE consumed_at IS NOT NULL',
          )
        ).rows[0].count;
        const stopped = once(child, 'exit');
        child.kill('SIGKILL');
        await stopped;
        const runtime = await backgroundRuntime(url!, handle, queue, {
          name: 'recovered-worker',
          concurrency: 2,
          lockDuration: 1000,
          stalledInterval: 500,
        });
        try {
          await until(
            async () => !(await queue.getJob(job.id!)),
            'stalled job recovered and acknowledged',
          );
          await Promise.all([
            handle({ operation: 'submit-governance-proposal', proposalId: opened.proposal_id }),
            handle({ operation: 'reconcile-governance-proposal', proposalId: opened.proposal_id }),
          ]);
          assert.equal(
            (
              await f.database.query(
                'SELECT count(*) FROM ledger_signing_intents WHERE consumed_at IS NOT NULL',
              )
            ).rows[0].count,
            signatures,
            'Redelivery must not allocate another nonce or signature.',
          );
          // This fixture's certificate, on a contract other tests' TIs share.
          assert.equal(
            (
              await f.contract.queryFilter(
                f.contract.filters.ProposalCreated(null, null, f.statusKey),
              )
            ).length,
            1,
          );
          assert.equal(
            (await f.contract.queryFilter(f.contract.filters.ProposalExecuted(null, f.statusKey)))
              .length,
            1,
          );
        } finally {
          await runtime.close();
        }
      },
    );

    await context.test(
      'phase tasks independently propose, sign and reconcile the actual contract',
      async () => {
        await f.database.query(
          "UPDATE registered_certificates SET ledger_standing='suspended',ledger_observed_at=clock_timestamp() WHERE id=$1",
          [f.certificate],
        );
        const opened = await proposals.propose(f.accounts.proposer, {
          credential_id: f.registered,
          action: 'reinstate',
          reason_code: 'issued_in_error',
        });
        await proposals.decide(f.accounts.mixed, opened.proposal_id, 'approved');
        await handle({ operation: 'submit-governance-proposal', proposalId: opened.proposal_id });
        let row = (
          await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
            opened.proposal_id,
          ])
        ).rows[0];
        assert.equal(row.onchain_state, 'proposed');
        assert.equal(row.applied_at, null);
        await Promise.all([
          handle({ operation: 'submit-governance-signature', proposalId: opened.proposal_id }),
          handle({ operation: 'submit-governance-signature', proposalId: opened.proposal_id }),
        ]);
        row = (
          await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
            opened.proposal_id,
          ])
        ).rows[0];
        assert.notEqual(row.onchain_state, 'executed');
        await handle({
          operation: 'reconcile-governance-proposal',
          proposalId: opened.proposal_id,
        });
        row = (
          await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
            opened.proposal_id,
          ])
        ).rows[0];
        assert.equal(row.onchain_state, 'executed');
        assert.ok(row.applied_at);
        await queue.drain();
      },
    );

    await context.test(
      'standing safety sweep uses an ordinary 300-second deduplication lease',
      async () => {
        await f.database.query(
          'UPDATE registered_certificates SET ledger_registered_at=NULL WHERE id=$1',
          [f.certificate],
        );
        try {
          await handle({ operation: 'sweep-standing' });
          await handle({ operation: 'sweep-standing' });
          const jobs = (await queue.getJobs(['prioritized'])).filter(
            (job) => job.data.operation === 'record-standing',
          );
          assert.equal(jobs.length, 1);
          assert.equal(
            jobs[0].opts.priority,
            2,
            'Only immediate standing work belongs to plr-now.',
          );
          assert.equal(jobs[0].opts.deduplication!.ttl, 300000);
          assert.equal(await queue.getDeduplicationJobId('standing-' + f.certificate), jobs[0].id);
          await queue.drain();
        } finally {
          await f.database.query(
            'UPDATE registered_certificates SET ledger_registered_at=clock_timestamp() WHERE id=$1',
            [f.certificate],
          );
        }
      },
    );

    await context.test(
      'recovery sweep queues every committed challenge and cleans expired state even without mail',
      async () => {
        let count = 21;
        let purged = 0;
        const pending = Array.from({ length: count }, (_, index) => ({ account_id: index + 1 }));
        const database = {
          query: async (sql: string) => ({
            rows: sql.includes('operator_password_resets') ? pending.slice(0, count) : [],
          }),
        } as unknown as Pool;
        const recoveryDomains = {
          passwordRecovery: {
            purgeExpired: async () => {
              purged++;
            },
          },
        } as unknown as Domains;
        const recover = backgroundHandlers(database, recoveryDomains, queue);
        await recover({ operation: 'sweep-governance' });
        assert.equal(
          (await queue.getJobs(['prioritized'])).filter(
            (job) => job.data.operation === 'send-recovery',
          ).length,
          21,
        );
        await queue.drain();
        count = 0;
        await recover({ operation: 'sweep-governance' });
        assert.equal(purged, 2);
      },
    );

    await context.test(
      'BullMQ uses the configured fixed retry delay and signature pending delay',
      async () => {
        const runtime = await backgroundRuntime(
          url!,
          async (task) => {
            if (task.operation === 'submit-governance-signature')
              throw new (await import('./types.ts')).ProposalPending();
            throw new Error('Provider failure with private details that must be redacted');
          },
          queue,
          { name: 'retry-worker', concurrency: 1 },
        );
        try {
          const reconciliation = await enqueue(queue, {
            operation: 'reconcile-governance-proposal',
            proposalId: randomUUID(),
          });
          await until(
            async () => (await reconciliation.getState()) === 'delayed',
            'fixed retry delayed',
          );
          const delayed = await queue.getJob(reconciliation.id!);
          assert.equal(delayed!.delay, 120000);
          assert.equal(delayed!.attemptsMade, 1);
          assert.equal(delayed!.failedReason, 'Background domain operation failed.');
          await delayed!.remove();
          const signature = await enqueue(queue, {
            operation: 'submit-governance-signature',
            proposalId: randomUUID(),
          });
          await until(
            async () => (await signature.getState()) === 'delayed',
            'missing proposal delayed',
          );
          const missing = await queue.getJob(signature.id!);
          assert.equal(missing!.delay, 3000);
          await missing!.remove();
        } finally {
          await runtime.close();
        }
      },
    );

    await context.test(
      'stable scheduler registration and urgent work bypass a normal backlog',
      async () => {
        await registerSchedules(queue);
        const first = await queue.getJobSchedulers();
        await registerSchedules(queue);
        assert.equal(await queue.getJobSchedulersCount(), 6);
        assert.deepEqual(
          (await queue.getJobSchedulers()).map((item) => [item.key, item.next]).sort(),
          first.map((item) => [item.key, item.next]).sort(),
        );
        const ids = Array.from({ length: 8 }, () => randomUUID());
        const urgent = randomUUID();
        let unblock!: () => void;
        const blocked = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const seen: string[] = [];
        const runtime = await backgroundRuntime(
          url!,
          async (task) => {
            if ('organizationId' in task) {
              seen.push(task.organizationId);
              if (task.organizationId === ids[0]) await blocked;
            } else if ('certificateId' in task) seen.push(task.certificateId);
          },
          queue,
          { name: 'priority-worker', concurrency: 1 },
        );
        try {
          for (const organizationId of ids)
            await enqueue(queue, { operation: 'withdraw-accreditation', organizationId });
          await until(() => seen.length === 1, 'first ordinary job running');
          await enqueue(queue, { operation: 'record-standing', certificateId: urgent });
          unblock();
          await until(() => seen.length === 9, 'backlog completed');
          assert.deepEqual(seen.slice(0, 2), [ids[0], urgent]);
          assert.deepEqual(seen.slice(2), ids.slice(1));
          await assert.rejects(
            handle({
              operation: 'record-standing',
              certificateId: randomUUID(),
              secret: 'must-never-enter-domain',
            } as BackgroundTask),
          );
          const client = createClient({ url });
          await client.connect();
          assert.ok((await client.keys(queuePrefix + ':*')).length > 0);
          await client.quit();
        } finally {
          unblock();
          await runtime.close();
        }
      },
    );
  },
);
