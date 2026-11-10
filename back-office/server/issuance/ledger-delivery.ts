import { GovernanceUnavailable } from '../lifecycle/governance.ts';
import type { Pool } from 'pg';
import type { CertificateLedger, LedgerRegistration } from './types.ts';
import type { Protection } from './protection.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';

/**
 * Deliver collected certificate registrations through retryable background delivery.
 * @param database - PostgreSQL pool.
 * @param ledger - Exact-registration certificate registry adapter.
 * @param protection - Field protection, unused since records carry no salted commitment.
 * @returns A bounded worker; provider failures remain pending for the next sweep.
 */
export function postgresIssuanceLedgerDelivery(
  database: Pool,
  ledger: Pick<CertificateLedger, 'ensureRegistered'>,
  protection?: Protection,
) {
  void protection;
  /**
   * Reconcile up to 48 collected registrations, serializing overlapping workers on each certificate.
   * @param certificateId - Optional concrete collected certificate, bypassing unrelated backlog.
   * @returns The number confirmed in this sweep.
   * @throws Database errors if reading or recording delivery cannot complete.
   * @remarks Uncollected offers never reach the ledger. A lost acknowledgement retries the same issued ID, dates and credential hash.
   */
  async function deliverRegistrations(certificateId?: string) {
    let failure: unknown;
    const { rows } = await database.query(
      `SELECT c.id FROM registered_certificates c
      JOIN credential_tokens t ON t.certificate_id=c.id AND t.redeemed_at IS NOT NULL
      WHERE c.registered_id IS NOT NULL AND c.ledger_registered_at IS NULL AND c.credential_hash IS NOT NULL
        AND ($1::uuid IS NULL OR c.id=$1)
      ORDER BY c.ledger_observed_at NULLS FIRST,c.id LIMIT 48`,
      [certificateId ?? null],
    );
    let confirmed = 0;
    for (const candidate of rows)
      confirmed += await transaction(database, async (client) => {
        const {
          rows: [certificate],
        } = await client.query(
          `SELECT c.* FROM registered_certificates c
        JOIN credential_tokens t ON t.certificate_id=c.id AND t.redeemed_at IS NOT NULL
        WHERE c.id=$1 AND c.registered_id IS NOT NULL AND c.ledger_registered_at IS NULL AND c.credential_hash IS NOT NULL
        FOR UPDATE OF c SKIP LOCKED`,
          [candidate.id],
        );
        if (!certificate) return 0;
        let providerAttempt = false;
        try {
          const record: LedgerRegistration = {
            id: certificate.credential_id,
            issuer: certificate.issuer_did,
            statusKey: '0x' + certificate.status_key.toString('hex'),
            credentialHash: '0x' + certificate.credential_hash.toString('hex'),
            validFrom: Math.floor(+certificate.valid_from / 1000),
            validUntil: Math.floor(+certificate.valid_until / 1000),
            standing: certificate.local_standing,
          };
          providerAttempt = true;
          await ledger.ensureRegistered(record);
        } catch (error) {
          failure = providerAttempt ? new GovernanceUnavailable() : error;
          await client.query(
            "UPDATE registered_certificates SET ledger_standing='unknown',ledger_observed_at=clock_timestamp() WHERE id=$1",
            [certificate.id],
          );
          return 0;
        }
        await client.query(
          'UPDATE registered_certificates SET ledger_registered_at=clock_timestamp(),ledger_standing=local_standing,ledger_observed_at=clock_timestamp() WHERE id=$1',
          [certificate.id],
        );
        if (certificate.local_standing === 'suspended' || certificate.local_standing === 'revoked')
          await client.query(
            'UPDATE certificate_emergency_suspensions SET applied_at=clock_timestamp() WHERE certificate_id=$1 AND applied_at IS NULL',
            [certificate.id],
          );
        await appendAudit(client, {
          event: 'certificate.ledger_registered',
          credentialId: certificate.credential_id,
          organizationId: certificate.issuer_id,
          detail: { status_key: '0x' + certificate.status_key.toString('hex') },
        });
        return 1;
      });
    if (certificateId && failure) throw failure;
    return confirmed;
  }
  return deliverRegistrations;
}
