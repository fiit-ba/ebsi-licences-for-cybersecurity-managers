import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { auditHash } from './journal.ts';
import { authorizeAuditor } from './service.ts';
import { timestampId } from './timestamp-ledger.ts';
import type { TimestampLedger } from './timestamp-ledger.ts';

/**
 * Create auditor-only anchor reads with optional live proof verification.
 *
 * @param database - PostgreSQL pool.
 * @param ledger - Optional pinned timestamp ledger reader.
 * @returns An actor/query reader returning bounded anchor evidence and cursor.
 */
export function postgresAnchorList(database: Pool, ledger?: TimestampLedger) {
  /**
   * Read anchor intents and verify matching evidence against the configured deployment.
   *
   * @param actor - Auditor account ID.
   * @param query - Required credential filter and optional before_entry_id cursor.
   * @returns Anchor rows, digest checks, proof observations and next cursor.
   * @throws IssuanceError for invalid cursor or missing auditor authority; database errors.
   * @remarks Unavailable or mismatched external proofs remain unverified rather than being reported
   * as anchored.
   */
  async function listAnchors(actor: number, query: URLSearchParams) {
    const credential = query.get('credential_id');
    if (!credential || credential.length > 255) return { results: [] };
    const before = query.get('before_entry_id');
    if (
      before !== null &&
      (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n)
    ) {
      throw new IssuanceError(400, 'InvalidCursor', 'Invalid anchor cursor.');
    }
    const rows = await transaction(database, async (client: PoolClient) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await authorizeAuditor(client, actor);
      return (
        await client.query(
          `
        SELECT anchor.*, e.event, e.occurred_at, e.entry_hash, e.previous_hash, e.payload
        FROM audit_anchors anchor JOIN audit_entries e ON e.id = anchor.entry_id
        WHERE (e.credential_id = $1 OR e.credential_id IN (
          SELECT unnest(ARRAY[c.credential_id,c.registered_id]) FROM registered_certificates c
          WHERE c.credential_id=$1 OR c.registered_id=$1)) AND ($2::bigint IS NULL OR anchor.entry_id < $2)
        ORDER BY anchor.entry_id DESC LIMIT 101
      `,
          [credential, before],
        )
      ).rows;
    });
    const results = [];
    for (let start = 0; start < Math.min(rows.length, 100); start += 4) {
      const batch = await Promise.all(
        rows.slice(start, Math.min(start + 4, 100)).map(async (row) => {
          const digest = '0x' + row.digest.toString('hex');
          const matches =
            row.digest.equals(row.entry_hash) &&
            row.digest.equals(auditHash(row.previous_hash, row.payload));
          let proof;
          let checked = false;
          if (
            ledger &&
            row.chain_id !== null &&
            Number(row.chain_id) === ledger.chainId &&
            row.contract === ledger.contract &&
            (!ledger.signerAddress || row.signer_address === ledger.signerAddress)
          ) {
            try {
              const observation = await ledger.observe(digest);
              checked = true;
              if (observation.state === 'confirmed' && row.signer_address === ledger.signerAddress)
                proof = observation.proof;
            } catch {
              /* Keep unavailable or mismatched evidence unverified. */
            }
          }
          return {
            anchor_id: row.id,
            entry_id: String(row.entry_id),
            kind: row.event,
            created_at: row.occurred_at,
            anchored_at: row.confirmed_at,
            digest,
            digest_matches: matches,
            anchored: Boolean(matches && proof),
            checked,
            timestamp: proof?.timestamp ?? null,
            timestamp_id: timestampId(digest),
            chain_id: row.chain_id,
            contract: row.contract,
            block_number: proof?.blockNumber ?? null,
            block_hash: proof?.blockHash ?? null,
            proof_matches_record:
              proof && row.block_hash
                ? row.block_hash === proof.blockHash &&
                  String(row.block_number) === proof.blockNumber
                : null,
            submission_hash: row.transaction_hash,
            delivery_failed: row.delivery_failed,
          };
        }),
      );
      results.push(...batch);
    }
    return { results, next: rows.length > 100 ? String(rows[99].entry_id) : null };
  }
  return listAnchors;
}
