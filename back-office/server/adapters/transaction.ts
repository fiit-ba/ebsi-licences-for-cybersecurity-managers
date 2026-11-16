/**
 * Execute work on one connection and commit it atomically.
 *
 * @param database - Pool from which to acquire a connection.
 * @param work - Async operation receiving the transaction connection.
 * @returns The operation result after commit.
 * @throws The operation or database error; rollback failures may replace the original error.
 * @remarks The connection is released in finally. External effects inside work are not undone by
 * Rollback. Registered post-commit callbacks run only after the connection is released.
 */
export async function transaction<T>(
  database: Pick<Pool, 'connect'>,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  const callbacks: (() => Promise<unknown>)[] = [];
  committedWork.set(client, callbacks);
  let result: T;
  try {
    await client.query('BEGIN');
    result = await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    committedWork.delete(client);
    client.release();
  }
  for (const callback of callbacks) await callback();
  return result;
}
import type { Pool, PoolClient } from 'pg';

const committedWork = new WeakMap<Pick<PoolClient, 'query'>, (() => Promise<unknown>)[]>();

/**
 * Register an in-memory callback on this transaction's successful commit.
 * @param client - Connection owned by transaction().
 * @param callback - Failure-tolerant broker submission, run after releasing the connection.
 * @returns No value; rollback discards callbacks.
 * @remarks This is not durable delivery. Domain rows and periodic reconciliation recover a lost callback.
 */
export function afterCommit(client: Pick<PoolClient, 'query'>, callback: () => Promise<unknown>) {
  committedWork.get(client)?.push(callback);
}
