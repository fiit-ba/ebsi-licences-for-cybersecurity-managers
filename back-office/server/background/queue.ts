import { Queue, type JobsOptions, type RedisOptions } from 'bullmq';
import type { PoolClient } from 'pg';
import { afterCommit } from '../adapters/transaction.ts';
import type { BackgroundTask } from './types.ts';

// A shared priority queue uses two execution slots by default without reserving backlog jobs.
export const queueName = 'plr';
export const queuePrefix = 'atest-bullmq';
export const urgentPriority = 1; // Urgent collection and emergency standing updates.
export const ordinaryPriority = 2;

/**
 * Validate the dedicated DB-0 broker URL and configure bounded producer failures.
 * @param url - Redis broker URL, never the cache DB-2 URL.
 * @param blocking - Whether the connection belongs to a long-lived BullMQ worker.
 * @returns BullMQ connection options without an ioredis keyPrefix.
 * @throws Error for an invalid protocol or database.
 */
export function brokerConnection(url: string, blocking = false): RedisOptions {
  const parsed = new URL(url);
  if (
    !['redis:', 'rediss:'].includes(parsed.protocol) ||
    !['', '/', '/0'].includes(parsed.pathname)
  )
    throw new Error('REDIS_BROKER_URL must address Redis database 0.');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: 0,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: blocking ? null : 1,
    enableOfflineQueue: blocking,
    connectTimeout: 2000,
    ...(blocking ? {} : { commandTimeout: 2000 }),
  };
}

/**
 * Create an explicitly namespaced producer; connection errors expose no URL or job contents.
 * @param url - Broker URL in DB 0.
 * @param failFast - Disable reconnect for a single committed submission; later submissions create a fresh client.
 * @returns An owned queue client, closed by its process runtime.
 */
export function backgroundQueue(url: string, failFast = false) {
  const queue = new Queue<BackgroundTask>(queueName, {
    prefix: queuePrefix,
    connection: { ...brokerConnection(url), ...(failFast ? { retryStrategy: () => null } : {}) },
  });
  queue.on('error', () => console.error('Background broker unavailable.'));
  return queue;
}

/**
 * Configure task-specific retry budgets and the urgent standing priority.
 * @param task - Identifier-only operation.
 * @returns BullMQ attempts, backoff, priority and terminal cleanup options.
 */
export function taskOptions(task: BackgroundTask): JobsOptions {
  const operation = task.operation;
  const backoff = [
    'record-standing',
    'submit-timestamp',
    'submit-governance-proposal',
    'submit-governance-signature',
    'withdraw-governance-proposal',
  ].includes(operation);
  return {
    priority: operation === 'record-standing' ? urgentPriority : ordinaryPriority,
    attempts:
      operation === 'submit-governance-signature'
        ? 21
        : backoff
          ? 6
          : operation === 'reconcile-governance-proposal'
            ? 4
            : 1,
    ...(backoff
      ? { backoff: { type: 'full-jitter' } }
      : operation === 'reconcile-governance-proposal'
        ? { backoff: { type: 'fixed', delay: 120_000 } }
        : {}),
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/**
 * Enqueue a concrete operation, preserving its priority across retries.
 * @param queue - Explicit owned producer.
 * @param task - Operation and minimal identifiers.
 * @param delay - Existing timelock ETA represented as a relative delay.
 * @returns The accepted BullMQ job; errors propagate to the caller.
 */
export async function enqueue(
  queue: ReturnType<typeof backgroundQueue>,
  task: BackgroundTask,
  delay = 0,
) {
  return queue.add(task.operation, task, { ...taskOptions(task), delay });
}

/**
 * Submit committed work without undoing the business decision during broker failure.
 * @param task - Concrete identifier-only task.
 * @returns Completion after submission or a redacted failure diagnostic.
 * @remarks The short-lived connection also lets ordinary bootstrap/CLI commands exit.
 * Unconfigured low-level domain fixtures have no broker. Compose always configures it.
 */
export async function enqueueCommitted(task: BackgroundTask) {
  if (!process.env.REDIS_BROKER_URL) return;
  let active: ReturnType<typeof backgroundQueue> | undefined;
  try {
    active = backgroundQueue(process.env.REDIS_BROKER_URL, true);
    await enqueue(active, task);
  } catch {
    console.error(
      `Background submission failed: ${task.operation}; periodic reconciliation remains responsible.`,
    );
  } finally {
    await active?.close().catch(() => console.error('Background producer cleanup failed.'));
  }
}

/**
 * Submit only after the domain transaction commits; rollback discards the request.
 * @param client - Current transaction() connection.
 * @param task - Concrete operation without private data.
 * @returns No value; registration neither connects to Redis nor contacts a provider.
 */
export function enqueueAfterCommit(client: Pick<PoolClient, 'query'>, task: BackgroundTask) {
  afterCommit(client, () => enqueueCommitted(task));
}
