import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * Limit login derivation work per trusted client address across server processes.
 * @param database - Shared application PostgreSQL pool.
 * @param secret - Private signing configuration used only to derive address bucket digests.
 * @param attemptsPerMinute - Maximum login requests per address in a one-minute window.
 * @returns An admission operation returning retry seconds when the window is full.
 * @throws Error for invalid configuration; admission rejects on database failure.
 * @remarks Counts known and unknown accounts identically and never stores addresses
 * or usernames. Shared attempt limits bound brute-force login requests.
 */
export function postgresLoginThrottle(database: Pool, secret: string, attemptsPerMinute = 30) {
  if (
    secret.length < 32 ||
    !Number.isSafeInteger(attemptsPerMinute) ||
    attemptsPerMinute < 1 ||
    attemptsPerMinute > 1000
  )
    throw new Error('Configure a private login limiter key and one to 1000 attempts per minute.');
  return async (address: string): Promise<number | null> => {
    const bucket = createHmac('sha256', secret)
      .update('atest-login-limit-v1:')
      .update(address)
      .digest();
    const state = (
      await database.query<{ attempts: number; retry: number }>(
        `INSERT INTO operator_login_limits(bucket,attempts,expires_at)
      VALUES ($1,1,clock_timestamp()+interval '1 minute') ON CONFLICT (bucket) DO UPDATE SET
      attempts=CASE WHEN operator_login_limits.expires_at<=clock_timestamp() THEN 1 ELSE LEAST(operator_login_limits.attempts+1,$2+1) END,
      expires_at=CASE WHEN operator_login_limits.expires_at<=clock_timestamp() THEN clock_timestamp()+interval '1 minute' ELSE operator_login_limits.expires_at END
      RETURNING attempts,GREATEST(1,ceil(extract(epoch FROM expires_at-clock_timestamp())))::integer AS retry`,
        [bucket, attemptsPerMinute],
      )
    ).rows[0];
    await database.query(`DELETE FROM operator_login_limits WHERE bucket IN (
      SELECT bucket FROM operator_login_limits WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 100) AND expires_at<clock_timestamp()`);
    return state.attempts > attemptsPerMinute ? state.retry : null;
  };
}
