import type { PoolClient } from 'pg';
import { OperatorManagementError } from './management-error.ts';

/** Serializes supported account/grant edits and identity import across server processes. */
export const operatorAdministrationLock = 901481013;

/**
 * Serialize an administration write and pin the acting account's current session.
 * @param client - Caller-owned transaction connection.
 * @param actor - Acting account ID from the verified request.
 * @param expectedVersion - Session generation observed by HTTP authentication.
 * @returns Completion after acquiring the administration and actor row locks.
 * @throws OperatorManagementError if the session changed while the write waited;
 * database errors.
 */
export async function lockAdministrationActor(
  client: PoolClient,
  actor: number,
  expectedVersion?: number,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [operatorAdministrationLock]);
  const account = (
    await client.query<{ active: boolean; auth_version: number }>(
      'SELECT active,auth_version FROM operator_accounts WHERE id=$1 FOR UPDATE',
      [actor],
    )
  ).rows[0];
  if (
    !account?.active ||
    (expectedVersion !== undefined && account.auth_version !== expectedVersion)
  )
    throw new OperatorManagementError(
      401,
      'SessionChanged',
      'Sign in again before changing accounts.',
    );
}
