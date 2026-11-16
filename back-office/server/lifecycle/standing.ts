import type { Pool } from 'pg';

/** Immutable certificate identity, validity and current standing read from the ledger. */
interface LedgerRecord {
  standing: bigint;
  issuerDid: string;
  credentialHash: string;
  validFrom: bigint;
  validUntil: bigint;
}

/** Local certificate fields and observation timestamp used during ledger refresh. */
interface StandingRow {
  id: string;
  credential_id: string;
  issuer_did: string;
  status_key: Buffer;
  credential_hash: Buffer;
  valid_from: Date | null;
  valid_until: Date | null;
  started_at: Date;
}

/**
 * Translate a ledger observation only when it identifies the expected certificate.
 *
 * @param record - Observed ledger record.
 * @param row - Expected local identity and explicit validity bounds.
 * @returns Active, suspended, revoked or unknown; mismatches remain unknown.
 */
function standing(record: LedgerRecord, row: StandingRow) {
  if (
    record.issuerDid !== row.issuer_did ||
    record.credentialHash.toLowerCase() !== '0x' + row.credential_hash.toString('hex') ||
    (row.valid_from && record.validFrom !== BigInt(Math.floor(+row.valid_from / 1000))) ||
    (row.valid_until && record.validUntil !== BigInt(Math.floor(+row.valid_until / 1000)))
  )
    return 'unknown';
  if (record.standing === 1n) return 'active';
  if (record.standing === 2n) return 'suspended';
  if (record.standing === 3n) return 'revoked';
  return 'unknown';
}

/**
 * Create a bounded background refresh for collected certificate standing.
 *
 * @param database - PostgreSQL pool.
 * @param ledger - Ledger status reader.
 * @returns A job refreshing at most 48 stale rows with eight concurrent reads.
 * @throws Database errors from the returned job.
 * @remarks Ledger failures become unknown. Conditional updates cannot overwrite newer observations
 * or invalidations.
 */
export function postgresStandingRefresh(
  database: Pool,
  ledger: { status(key: string): Promise<LedgerRecord> },
) {
  /**
   * Refresh a bounded batch while retaining concurrent invalidation ordering.
   *
   * @returns Completion of the selected row updates.
   * @throws Database errors if a query, lock or commit fails.
   */
  async function refreshStanding() {
    const { rows } = await database.query<StandingRow>(`
      SELECT c.id, c.credential_id, c.issuer_did, c.status_key, c.credential_hash,
        c.valid_from, c.valid_until, statement_timestamp() AS started_at
      FROM registered_certificates c
      JOIN credential_tokens token ON token.certificate_id = c.id AND token.redeemed_at IS NOT NULL
      WHERE c.status_key IS NOT NULL AND (c.ledger_observed_at IS NULL OR c.ledger_observed_at <= statement_timestamp() - interval '15 seconds')
      ORDER BY c.ledger_observed_at NULLS FIRST, c.id LIMIT 48
    `);
    for (let index = 0; index < rows.length; index += 8) {
      await Promise.all(
        rows.slice(index, index + 8).map(async (row) => {
          let state: ReturnType<typeof standing> = 'unknown';
          try {
            state = standing(await ledger.status('0x' + row.status_key.toString('hex')), row);
          } catch {
            // Failed reads must not keep an apparently valid status alive.
          }
          await database.query(
            `
          UPDATE registered_certificates
          SET ledger_standing = $2, ledger_observed_at = $3
          WHERE id = $1 AND (ledger_observed_at IS NULL OR ledger_observed_at < $3)
            AND (ledger_observation_invalidated_at IS NULL OR ledger_observation_invalidated_at < $3)
        `,
            [row.id, state, row.started_at],
          );
        }),
      );
    }
  }
  return refreshStanding;
}
