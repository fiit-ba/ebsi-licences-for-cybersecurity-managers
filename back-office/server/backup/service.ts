import type { Pool } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import {
  backupDigest,
  BackupRefused,
  verifyBackupProof,
  versionJson,
  type BackupKey,
} from './proof.ts';

const storedColumns = `public_key,ciphertext,version,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

/** Original single-version storage projection, without holder identity or proof. */
interface BackupRow {
  public_key: BackupKey;
  ciphertext: string;
  version: string;
  updated_at: string;
}

/**
 * Construct the original encrypted-backup size refusal.
 * @param limit - Maximum base64url text characters (and bounded request bytes).
 * @returns Public 413 refusal.
 */
export function backupTooLarge(limit: number) {
  return new BackupRefused('TooLarge', `A backup holds at most ${limit} bytes`, 413);
}

/**
 * Serialize a UTC timestamp with microsecond padding.
 * @param row - Persisted backup timestamp and version.
 * @returns Upload/read metadata with an exact JSON integer version.
 */
function metadata(row: BackupRow) {
  return {
    version: versionJson(row.version),
    updated_at: row.updated_at.replace('.000000Z', 'Z'),
  };
}

/**
 * Own the original backup model and signed mutation transactions.
 * @param database - Application PostgreSQL pool.
 * @param maxBytes - Original configurable ciphertext text limit, default 128 MiB.
 * @returns Latest read, signed store/delete operations and the configured bound.
 * @throws Error for invalid size configuration; operations propagate database failures.
 * @remarks No operator account, plaintext, DID, proof history or version history is stored.
 * Existing-row locks preserve monotonic writes. Concurrent first inserts
 * may hit the primary-key constraint; that inherited race remains a 500.
 */
export function postgresWalletBackups(database: Pool, maxBytes = 128 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error('Invalid backup size limit.');
  return {
    maxBytes,
    /**
     * Read the public opaque latest envelope.
     * @param id - Route backup address.
     * @returns Original JSON read body or null for no backup.
     * @throws Database errors.
     */
    async read(id: string) {
      const row = (
        await database.query<BackupRow>(
          `SELECT ${storedColumns} FROM plr_walletbackup WHERE backup_id=$1`,
          [id],
        )
      ).rows[0];
      return row ? { ...metadata(row), ciphertext: row.ciphertext } : null;
    },
    /**
     * Replace one latest envelope after verifying its key, digest and increasing version.
     * @param id - Opaque backup thumbprint.
     * @param body - Parsed JSON input, with integer tokens as bigint.
     * @returns Original upload metadata.
     * @throws BackupRefused for invalid input/proof or stale versions; database errors otherwise.
     */
    async store(id: string, body: Record<string, any>) {
      const { ciphertext, version } = body;
      if (!/^[A-Za-z0-9_-]{43}$/.test(id))
        throw new BackupRefused('InvalidBackup', 'Not a backup address', 404);
      if (typeof ciphertext !== 'string' || !ciphertext || !/^[A-Za-z0-9_-]+$/.test(ciphertext))
        throw new BackupRefused('InvalidBackup', 'The ciphertext is base64url text');
      if (ciphertext.length > maxBytes) throw backupTooLarge(maxBytes);
      if (typeof version !== 'bigint' || version < 1n)
        throw new BackupRefused('InvalidBackup', 'The version is a positive integer');
      return transaction(database, async (client) => {
        const stored = (
          await client.query<BackupRow>(
            `SELECT ${storedColumns} FROM plr_walletbackup WHERE backup_id=$1 FOR UPDATE`,
            [id],
          )
        ).rows[0];
        const { key, claims } = verifyBackupProof(String(body.proof ?? ''), id, stored?.public_key);
        const signedVersion =
          typeof claims.version === 'boolean' ? BigInt(claims.version) : claims.version;
        if (
          (typeof signedVersion !== 'bigint' && typeof signedVersion !== 'number') ||
          (typeof signedVersion === 'number' && !Number.isInteger(signedVersion)) ||
          BigInt(signedVersion) !== version ||
          claims.digest !== backupDigest(ciphertext)
        )
          throw new BackupRefused('InvalidProof', 'The proof is for another upload');
        if (stored && version <= BigInt(stored.version))
          throw new BackupRefused(
            'StaleVersion',
            `The backup is at version ${stored.version} already`,
            409,
            { version: versionJson(stored.version) },
          );
        const row = (
          await client.query<BackupRow>(
            stored
              ? `UPDATE plr_walletbackup SET ciphertext=$2,version=$3,updated_at=clock_timestamp() WHERE backup_id=$1 RETURNING ${storedColumns}`
              : `INSERT INTO plr_walletbackup(backup_id,ciphertext,version,public_key,created_at,updated_at) VALUES ($1,$2,$3,$4,clock_timestamp(),clock_timestamp()) RETURNING ${storedColumns}`,
            stored
              ? [id, ciphertext, version.toString()]
              : [id, ciphertext, version.toString(), key],
          )
        ).rows[0];
        return metadata(row);
      });
    },
    /**
     * Delete the current row when its stored key authorizes deletion.
     * @param id - Opaque backup thumbprint.
     * @param proof - Compact deletion JWS.
     * @returns Whether a row existed; missing rows do not require a proof.
     * @throws BackupRefused for unauthorized deletion; database errors otherwise.
     */
    async remove(id: string, proof: string) {
      return transaction(database, async (client) => {
        const stored = (
          await client.query<BackupRow>(
            'SELECT public_key FROM plr_walletbackup WHERE backup_id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!stored) return false;
        const { claims } = verifyBackupProof(proof, id, stored.public_key);
        if (claims.delete !== true)
          throw new BackupRefused(
            'InvalidProof',
            'The proof does not ask for the backup to be deleted',
          );
        await client.query('DELETE FROM plr_walletbackup WHERE backup_id=$1', [id]);
        return true;
      });
    },
  };
}
