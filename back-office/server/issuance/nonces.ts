import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { secretDigest } from './protection.ts';

/** How long a c_nonce from the Nonce Endpoint may be used, in seconds. */
const lifetimeSeconds = 300;

/**
 * Create the OpenID4VCI 1.0 Nonce Endpoint's store: one-time c_nonce values, kept as digests.
 *
 * @param database - PostgreSQL pool.
 * @returns Issue and consume operations.
 */
export function postgresCredentialNonces(database: Pool) {
  return {
    /**
     * Issue a fresh c_nonce and forget long-expired ones.
     * @returns The nonce.
     * @throws Database or crypto errors.
     */
    async issue() {
      const nonce = randomBytes(32).toString('base64url');
      await database.query(
        "DELETE FROM credential_nonces WHERE expires_at < statement_timestamp() - interval '1 hour'",
      );
      await database.query(
        `INSERT INTO credential_nonces(nonce_digest,expires_at)
         VALUES($1,statement_timestamp()+$2*interval '1 second')`,
        [secretDigest(nonce), lifetimeSeconds],
      );
      return { nonce, expiresIn: lifetimeSeconds };
    },
    /**
     * Spend a c_nonce a key proof names, once.
     * @param client - The credential request's transaction.
     * @param nonce - Untrusted nonce from the proof.
     * @returns Whether it was a live, unused nonce of this issuer.
     * @throws Database errors.
     */
    async consume(client: Pick<PoolClient, 'query'>, nonce: unknown) {
      if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return false;
      const { rowCount } = await client.query(
        `UPDATE credential_nonces SET consumed_at=statement_timestamp()
         WHERE nonce_digest=$1 AND consumed_at IS NULL AND expires_at>statement_timestamp()`,
        [secretDigest(nonce)],
      );
      return rowCount === 1;
    },
  };
}

/** One-time c_nonce store of the Nonce Endpoint. */
export type CredentialNonces = ReturnType<typeof postgresCredentialNonces>;
