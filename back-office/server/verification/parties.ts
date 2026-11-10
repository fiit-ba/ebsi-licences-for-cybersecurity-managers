import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { secretDigest } from '../issuance/protection.ts';

/** Authenticated external verifier principal, distinct from operator accounts. */
export interface RelyingParty {
  id: string;
  name: string;
}

/**
 * Restore the existing relying-party key lifecycle and live API authentication.
 * @param database - PostgreSQL executor.
 * @returns Create/list/revoke and ApiKey authentication operations.
 */
export function postgresRelyingParties(database: Pick<Pool, 'query'>) {
  return {
    /**
     * Register a relying party and disclose its key exactly once.
     * @param name - Unique external system name.
     * @returns Principal and raw plr_rp_ key; callers must not log it except the explicit CLI output.
     * @throws Database errors, including duplicate names.
     */
    async create(name: string) {
      const key = 'plr_rp_' + randomBytes(32).toString('base64url');
      const {
        rows: [party],
      } = await database.query<RelyingParty>(
        `INSERT INTO relying_parties(name,key_prefix,key_digest) VALUES($1,$2,$3) RETURNING id,name`,
        [name, key.slice(0, 16), secretDigest(key)],
      );
      return { party, key };
    },
    /**
     * Read relying-party administration metadata without secrets.
     * @returns Parties ordered by name and their live/revoked/last-used state.
     * @throws Database query errors.
     */
    async list() {
      return (
        await database.query('SELECT name,active,last_used_at FROM relying_parties ORDER BY name')
      ).rows;
    },
    /**
     * Revoke the named party's API access immediately.
     * @param name - Existing party name.
     * @returns Whether a party was found.
     * @throws Database query errors.
     */
    async revoke(name: string) {
      return (
        (await database.query('UPDATE relying_parties SET active=false WHERE name=$1', [name]))
          .rowCount === 1
      );
    },
    /**
     * Authenticate only the ApiKey scheme and current active key digest.
     * @param header - Authorization header.
     * @returns Principal or undefined for absent, invalid or revoked authorization.
     * @throws Database errors; inactive credentials never authenticate from cached state.
     */
    async authenticate(header: string | undefined) {
      if (!header?.startsWith('ApiKey ')) return;
      const key = header.slice(7).trim();
      const digest = secretDigest(key);
      const { rows } = await database.query(
        'SELECT id,name,key_digest FROM relying_parties WHERE active AND key_prefix=$1',
        [key.slice(0, 16)],
      );
      for (const candidate of rows) {
        if (!timingSafeEqual(candidate.key_digest, digest)) continue;
        const {
          rows: [party],
        } = await database.query<RelyingParty>(
          'UPDATE relying_parties SET last_used_at=statement_timestamp() WHERE id=$1 AND active AND key_digest=$2 RETURNING id,name',
          [candidate.id, digest],
        );
        return party;
      }
    },
  };
}
