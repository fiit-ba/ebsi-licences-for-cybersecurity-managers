import { GovernanceUnavailable } from './governance.ts';
import { openReason } from './reason-storage.ts';
import type { Pool } from 'pg';
import { appendAudit } from '../audit/journal.ts';
import { transaction } from '../adapters/transaction.ts';
import type { Protection } from '../issuance/protection.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import { lockIssuerChain } from './access.ts';
import type { EmergencyLedger } from './emergency-ledger.ts';

/**
 * Create durable delivery for pending protective suspensions.
 *
 * @param database - PostgreSQL pool.
 * @param ledger - Pinned emergency ledger adapter.
 * @param protection - Private reason decryption.
 * @returns A worker handling at most 20 eligible emergency requests.
 */
export function postgresEmergencyDelivery(
  database: Pool,
  ledger: EmergencyLedger,
  protection: Protection,
) {
  /**
   * Deliver emergencies and invalidate cached standing after confirmation.
   * @param certificateId - Optional collected certificate whose pending emergency is delivered.
   *
   * @returns Completion after the selected batch.
   * @throws Database errors if retry/failure bookkeeping cannot be stored.
   * @remarks Delivery failures are kept pending. Revocation after the request does not suppress its
   * protective write.
   */
  async function deliverEmergencySuspensions(certificateId?: string) {
    let failure: unknown;
    const { rows } = await database.query<{ id: string }>(
      `
      SELECT id FROM certificate_emergency_suspensions WHERE applied_at IS NULL AND ($1::uuid IS NULL OR certificate_id=$1)
        AND ($1::uuid IS NOT NULL OR delivery_attempted_at IS NULL OR delivery_attempted_at < clock_timestamp() - interval '15 seconds')
      ORDER BY delivery_attempted_at NULLS FIRST, requested_at, id LIMIT 20
    `,
      [certificateId ?? null],
    );
    for (const { id } of rows) {
      try {
        // Keep the deployment fixed even if RPC succeeds and the DB rolls back.
        await database.query(
          `
          UPDATE certificate_emergency_suspensions SET onchain_contract = $2, onchain_chain_id = $3
          WHERE id = $1 AND onchain_contract IS NULL AND applied_at IS NULL
        `,
          [id, ledger.contract, ledger.chainId],
        );
        await transaction(database, async (client) => {
          const {
            rows: [target],
          } = await client.query(
            `
            SELECT c.id, c.issuer_id FROM certificate_emergency_suspensions emergency
            JOIN registered_certificates c ON c.id = emergency.certificate_id WHERE emergency.id = $1
          `,
            [id],
          );
          if (!target) return;
          // Revocation after the request must not prevent the protective write.
          await lockIssuerChain(client, target.issuer_id);
          const { rowCount } = await client.query(
            'SELECT id FROM registered_certificates WHERE id = $1 FOR UPDATE SKIP LOCKED',
            [target.id],
          );
          if (!rowCount) return;
          const {
            rows: [record],
          } = await client.query(
            `
            SELECT emergency.*, c.issuer_did, c.certificate_number, c.credential_id, c.status_key, c.credential_hash
            FROM certificate_emergency_suspensions emergency
            JOIN registered_certificates c ON c.id = emergency.certificate_id
            WHERE emergency.id = $1 AND emergency.applied_at IS NULL
              AND ($2::boolean OR emergency.delivery_attempted_at IS NULL OR
                emergency.delivery_attempted_at < clock_timestamp() - interval '15 seconds')
            FOR UPDATE OF emergency
          `,
            [id, Boolean(certificateId)],
          );
          if (!record) return;
          await client.query('SAVEPOINT emergency_delivery');
          try {
            if (
              record.onchain_contract !== ledger.contract ||
              Number(record.onchain_chain_id) !== ledger.chainId
            ) {
              throw new Error('The emergency belongs to a different governance deployment.');
            }
            const privateReason = await openReason(record, protection);
            const reason = reasonCommitment(
              privateReason.code,
              privateReason.note,
              privateReason.salt,
            );
            if (!reason.equals(record.reason_hash))
              throw new Error('The emergency reason has changed.');
            // Suspension at once acts on the collected certificate's record.
            if (!record.status_key || !record.credential_hash)
              throw new Error('The certificate has no record on the certificate registry yet.');
            try {
              await ledger.suspend({
                statusKey: '0x' + record.status_key.toString('hex'),
                credentialId: record.credential_id,
                issuerDid: record.issuer_did,
                credentialHash: '0x' + record.credential_hash.toString('hex'),
                reasonHash: '0x' + reason.toString('hex'),
              });
            } catch {
              throw new GovernanceUnavailable();
            }
            await client.query(
              `
              UPDATE certificate_emergency_suspensions SET applied_at = clock_timestamp(),
                delivery_attempted_at = clock_timestamp(), delivery_failed = false WHERE id = $1
            `,
              [id],
            );
            // The confirmed event may precede a later reinstatement. Refresh
            // current standing rather than overwrite it with the old emergency.
            await client.query(
              `
              UPDATE registered_certificates SET ledger_standing = NULL, ledger_observed_at = NULL,
                ledger_observation_invalidated_at = clock_timestamp() WHERE id = $1
            `,
              [record.certificate_id],
            );
            await appendAudit(client, {
              event: 'status.emergency_confirmed',
              credentialId: record.credential_id,
              detail: {
                emergency_id: id,
                chain_id: ledger.chainId,
                contract: ledger.contract,
                reason_hash: '0x' + reason.toString('hex'),
              },
            });
            await client.query('RELEASE SAVEPOINT emergency_delivery');
          } catch (error) {
            failure = error;
            await client.query('ROLLBACK TO SAVEPOINT emergency_delivery');
            await client.query(
              `
              UPDATE certificate_emergency_suspensions SET delivery_attempted_at = clock_timestamp(), delivery_failed = true
              WHERE id = $1
            `,
              [id],
            );
            if (!record.delivery_failed)
              await appendAudit(client, {
                event: 'governance.emergency_failed',
                credentialId: record.credential_id,
                detail: { emergency_id: id },
              });
          }
        });
      } catch (error) {
        failure = error;
        await database.query(
          `
          UPDATE certificate_emergency_suspensions SET delivery_attempted_at = clock_timestamp(), delivery_failed = true
          WHERE id = $1 AND applied_at IS NULL
        `,
          [id],
        );
      }
    }
    if (certificateId && failure) throw failure;
  }
  return deliverEmergencySuspensions;
}
