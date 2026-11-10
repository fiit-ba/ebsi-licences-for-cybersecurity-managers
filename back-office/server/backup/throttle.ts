import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from '../adapters/transaction.ts';

/**
 * Build the existing per-address weighted-window limit with shared durable state.
 * @param database - Application PostgreSQL pool.
 * @param secret - Private key used to derive address buckets without storing raw addresses.
 * @param rate - Count/period setting, default thirty requests per minute.
 * @param clock - Optional test clock in epoch seconds; production uses the locked transaction's database clock.
 * @returns Admission operation returning retry seconds when the current window is full.
 * @throws Error for malformed configuration; admission rejects on database failure.
 * @remarks Counts malformed payloads too. Row locks prevent parallel oversubscription;
 * forwarded address trust belongs to the HTTP ingress adapter.
 */
export function postgresBackupThrottle(
  database: Pool,
  secret: string,
  rate = '30/min',
  clock?: () => number,
) {
  const parsed = /^(0|[1-9]\d*)\/([smhd])[^/]*$/.exec(rate);
  const count = Number(parsed?.[1]);
  const period = parsed?.[2]?.[0];
  const seconds = ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[period ?? ''];
  if (secret.length < 32 || !parsed || !Number.isSafeInteger(count) || count > 2147483646)
    throw new Error('Configure a private backup limiter key and a valid count/period rate.');
  /**
   * Admit one request across processes without retaining the raw client address.
   * @param address - Direct client or trusted-ingress-resolved address.
   * @returns Null for admission, or ceil seconds until the window ends.
   * @throws Database errors; admission fails closed through the HTTP boundary.
   */
  async function admit(address: string): Promise<number | null> {
    const bucket = createHmac('sha256', secret)
      .update('atest-wallet-backup-v1:')
      .update(address)
      .digest();
    const retry = await transaction(database, async (client) => {
      await client.query(
        `INSERT INTO wallet_backup_limits(bucket,expires_at)
        VALUES ($1,clock_timestamp()+$2*interval '1 second') ON CONFLICT DO NOTHING`,
        [bucket, seconds],
      );
      const row = (
        await client.query<{ window_start: string; current_count: number; previous_count: number }>(
          'SELECT window_start,current_count,previous_count FROM wallet_backup_limits WHERE bucket=$1 FOR UPDATE',
          [bucket],
        )
      ).rows[0];
      const now = clock
        ? clock()
        : (
            await client.query<{ now: number }>(
              'SELECT extract(epoch FROM clock_timestamp())::double precision AS now',
            )
          ).rows[0].now;
      if (!Number.isFinite(now) || now < 0) throw new Error('Invalid backup clock.');
      const window = Math.floor(now / seconds);
      const into = now - window * seconds;
      const previous =
        Number(row.window_start) === window
          ? row.previous_count
          : Number(row.window_start) === window - 1
            ? row.current_count
            : 0;
      const current = Number(row.window_start) === window ? row.current_count : 0;
      const allowed = previous * (1 - into / seconds) + current + 1 <= count;
      await client.query(
        `UPDATE wallet_backup_limits SET window_start=$2,current_count=$3,previous_count=$4,
        expires_at=clock_timestamp()+$5*interval '1 second' WHERE bucket=$1`,
        [bucket, window, current + (allowed ? 1 : 0), previous, seconds * 2],
      );
      return allowed ? null : Math.max(1, Math.ceil(seconds - into));
    });
    await database.query(`DELETE FROM wallet_backup_limits WHERE bucket IN (
      SELECT bucket FROM wallet_backup_limits WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 100)
      AND expires_at<clock_timestamp()`);
    return retry;
  }

  return admit;
}
