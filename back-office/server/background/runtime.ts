import { Worker, UnrecoverableError } from 'bullmq';
import { brokerConnection, queueName, queuePrefix, type backgroundQueue } from './queue.ts';
import { registerSchedules } from './schedules.ts';
import { ProposalPending, type BackgroundTask } from './types.ts';

/**
 * Compute exponential backoff with full integer-second jitter, starting at one second and capped at 600 seconds.
 * @param attemptsMade - BullMQ failed attempt count, starting at one.
 * @param type - Configured custom backoff name.
 * @param error - Domain failure; missing proposals have a separate 3-second retry.
 * @param job - Current job, used for the signature-specific retry limit.
 * @returns Delay in milliseconds, or -1 when the task retry budget is exhausted.
 */
export function fullJitterBackoff(
  attemptsMade: number,
  type: string | undefined,
  error?: Error,
  job?: { name: string },
) {
  if (type !== 'full-jitter') throw new Error('Unknown background retry strategy.');
  if (error instanceof ProposalPending) return attemptsMade <= 20 ? 3000 : -1;
  if (job?.name === 'submit-governance-signature' && attemptsMade > 5) return -1;
  const cap = Math.min(600, 2 ** (attemptsMade - 1));
  return Math.floor(Math.random() * (cap + 1)) * 1000;
}

/**
 * Start the independent BullMQ consumer and idempotent beat replacement.
 * @param url - Broker DB-0 URL.
 * @param handle - Existing-domain dispatcher.
 * @param queue - Producer shared by schedules and follow-up tasks.
 * @param options - Worker identity and existing concurrency setting; test-only lock timings.
 * @returns A live worker and graceful draining operation.
 * @throws Broker or invalid configuration errors before startup completes.
 * @remarks BullMQ renews active locks and recovers stalled deliveries; PostgreSQL remains authoritative.
 */
export async function backgroundRuntime(
  url: string,
  handle: (task: BackgroundTask) => Promise<unknown>,
  queue: ReturnType<typeof backgroundQueue>,
  options: { name: string; concurrency?: number; lockDuration?: number; stalledInterval?: number },
) {
  const concurrency = options.concurrency ?? Number(process.env.PLR_WORKER_CONCURRENCY ?? 2);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error('Invalid PLR_WORKER_CONCURRENCY.');
  const worker = new Worker<BackgroundTask>(
    queueName,
    async (job) => {
      try {
        await handle(job.data);
      } catch (error) {
        if (error instanceof ProposalPending || error instanceof UnrecoverableError) throw error;
        // Redis must not retain provider bodies, tokens, requests or complete decisions.
        throw new Error('Background domain operation failed.');
      }
    },
    {
      prefix: queuePrefix,
      name: options.name,
      connection: brokerConnection(url, true),
      concurrency,
      autorun: false,
      settings: { backoffStrategy: fullJitterBackoff },
      ...(options.lockDuration ? { lockDuration: options.lockDuration } : {}),
      ...(options.stalledInterval ? { stalledInterval: options.stalledInterval } : {}),
    },
  );
  worker.on('error', () => console.error('Background worker broker connection failed.'));
  worker.on('failed', (job) =>
    console.error(`Background operation failed: ${job?.name ?? 'unknown'}.`),
  );
  const client = await queue.client;
  let stopping = false;
  let registration: Promise<void> = Promise.resolve();
  const restore = () => {
    registration = registration
      .then(() => (stopping ? undefined : registerSchedules(queue)))
      .catch(() => {
        console.error('Background schedule registration failed; reconnect will retry.');
      });
  };
  client.on('ready', restore);
  try {
    await worker.waitUntilReady();
    await registerSchedules(queue);
    void worker.run().catch(() => console.error('Background worker stopped unexpectedly.'));
    return {
      worker,
      /** Drain active jobs before releasing provider/DB connections. @returns Completion once no task uses domain dependencies. */
      async close() {
        stopping = true;
        client.off('ready', restore);
        await worker.close();
        await registration;
      },
    };
  } catch (error) {
    client.off('ready', restore);
    await worker.close(true);
    throw error;
  }
}
