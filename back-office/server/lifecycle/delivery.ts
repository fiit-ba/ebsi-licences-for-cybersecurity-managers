import { GovernanceUnavailable } from './governance.ts';
import { openReason } from './reason-storage.ts';
import { anchorDecision } from '../audit/decisions.ts';
import { postgresRejectionDelivery } from './rejection-delivery.ts';
import { statusActions } from './proposals.ts';
import { lockIssuerChain } from './access.ts';
import { appendAudit } from '../audit/journal.ts';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import type { Protection } from '../issuance/protection.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import type { GovernanceActions } from './governance.ts';
import { postgresOrganizationCancellations } from '../accreditation/cancellations.ts';

/**
 * Create a bounded retry worker for approved decisions and withdrawals.
 *
 * @param database - PostgreSQL pool.
 * @param governance - Pinned governance adapter.
 * @param protection - Private reason decryption.
 * @returns A job delivering at most 20 eligible cases.
 */
export function postgresGovernanceDelivery(
  database: Pool,
  governance: GovernanceActions,
  protection: Protection,
) {
  const deliverRejections = postgresRejectionDelivery(database, governance, protection);
  const deliverCancellations = postgresOrganizationCancellations(database, governance, protection);
  /**
   * Deliver or reconcile eligible cases with certificate and proposal locks.
   * @param proposalId - Optional concrete case; omission retains a bounded batch.
   * @param phase - Proposal, signature, reconciliation or withdrawal phase; omission delivers all eligible phases.
   *
   * @returns Completion after handling the selected batch.
   * @throws Database errors when failure bookkeeping itself cannot be persisted.
   * @remarks Deployment identity is committed before external effects. Per-case delivery failures
   * remain retryable and are journaled.
   */
  async function deliverApprovedCases(
    proposalId?: string,
    phase?: 'propose' | 'sign' | 'reconcile' | 'withdraw',
  ) {
    let failure: unknown;
    let progress: import('./governance.ts').GovernanceProgress | undefined;
    if (!proposalId || phase === 'withdraw') {
      await deliverCancellations(proposalId);
      await deliverRejections(proposalId);
    }
    // Rotate failed and waiting cases fairly. Each transaction locks a case
    // and its certificate so overlapping workers cannot submit it twice.
    const { rows } = await database.query<{ id: string }>(
      `
      SELECT id FROM certificate_status_proposals
      WHERE requires_governance AND decision IS DISTINCT FROM 'rejected' AND applied_at IS NULL AND closed_at IS NULL
        AND ($1::uuid IS NULL OR id=$1)
        AND ($1::uuid IS NOT NULL OR delivery_attempted_at IS NULL OR delivery_attempted_at < clock_timestamp() - interval '15 seconds')
      ORDER BY delivery_attempted_at NULLS FIRST, proposed_at, id LIMIT 20
    `,
      [proposalId ?? null],
    );
    for (const { id } of rows) {
      try {
        // Pin deployment identity in a separate commit before any external
        // side effect. A lost transaction response cannot switch the case
        // to a newly configured contract on the next process start.
        await database.query(
          `
          UPDATE certificate_status_proposals SET onchain_contract = COALESCE(onchain_contract, $2),
            onchain_chain_id = COALESCE(onchain_chain_id, $3), delivery_uncertain = true
          WHERE id = $1 AND decision IS DISTINCT FROM 'rejected'
            AND requires_governance AND applied_at IS NULL AND closed_at IS NULL
        `,
          [id, governance.contract, governance.chainId],
        );
        await transaction(database, async (client: PoolClient) => {
          const {
            rows: [target],
          } = await client.query<{ certificate_id: string; issuer_id: string }>(
            `
            SELECT p.certificate_id, c.issuer_id FROM certificate_status_proposals p
            JOIN registered_certificates c ON c.id = p.certificate_id WHERE p.id = $1
          `,
            [id],
          );
          if (!target) return;
          const { revoked } = await lockIssuerChain(client, target.issuer_id);
          const { rowCount: locked } = await client.query(
            'SELECT id FROM registered_certificates WHERE id = $1 FOR UPDATE SKIP LOCKED',
            [target.certificate_id],
          );
          if (!locked) return;
          const {
            rows: [record],
          } = await client.query(
            `
            SELECT p.*, c.issuer_did, c.certificate_number, c.credential_id, c.status_key, c.credential_hash, c.local_standing AS registry_state
            FROM certificate_status_proposals p JOIN registered_certificates c ON c.id = p.certificate_id
            WHERE p.id = $1 AND p.requires_governance AND p.decision IS DISTINCT FROM 'rejected' AND p.applied_at IS NULL AND p.closed_at IS NULL
              AND ($2::boolean OR p.delivery_attempted_at IS NULL OR p.delivery_attempted_at < clock_timestamp() - interval '15 seconds')
            FOR UPDATE OF p
          `,
            [id, Boolean(proposalId)],
          );
          if (!record) return;
          await client.query('SAVEPOINT delivery');
          try {
            const withdrawing = Boolean(record.withdrawal_requested_at);
            if (!withdrawing && revoked && record.action !== 'revoke') {
              throw new Error('Only revocation can be delivered for a withdrawn issuer.');
            }
            if (
              record.onchain_contract &&
              (record.onchain_contract !== governance.contract ||
                Number(record.onchain_chain_id) !== governance.chainId)
            ) {
              throw new Error('The approved case belongs to a different governance deployment.');
            }
            const privateReason = await openReason(record, protection);
            const expectedReason = reasonCommitment(
              privateReason.code,
              privateReason.note,
              privateReason.salt,
            );
            if (!expectedReason.equals(record.reason_hash))
              throw new Error('The approved reason has changed.');
            // A proposal names the collected certificate's record: no key before collection.
            if (!record.status_key || !record.credential_hash)
              throw new Error('The certificate has no record on the certificate registry yet.');
            const proposal = {
              reasonHash: '0x' + expectedReason.toString('hex'),
              action: record.action,
              onchainId: record.onchain_proposal_id,
              statusKey: '0x' + record.status_key.toString('hex'),
              credentialId: record.credential_id,
              issuerDid: record.issuer_did,
              credentialHash: '0x' + record.credential_hash.toString('hex'),
              approved: record.decision === 'approved',
              phase: phase === 'withdraw' ? undefined : phase,
            };
            let result;
            if (withdrawing) {
              const privateWithdrawal = await openReason(
                {
                  reason_code: 'withdrawn',
                  reason_note: record.withdrawal_note,
                  reason_salt: record.withdrawal_salt,
                  reason_hash: record.withdrawal_hash,
                },
                protection,
              );
              const withdrawal = reasonCommitment(
                'withdrawn',
                privateWithdrawal.note,
                privateWithdrawal.salt,
              );
              if (!withdrawal.equals(record.withdrawal_hash))
                throw new Error('The withdrawal reason has changed.');
              try {
                result = await governance.withdraw(proposal, '0x' + withdrawal.toString('hex'));
              } catch {
                throw new GovernanceUnavailable();
              }
            } else {
              try {
                result = await governance.advance(proposal);
              } catch {
                throw new GovernanceUnavailable();
              }
            }
            progress = result;
            const canApply =
              (!phase || phase === 'reconcile') &&
              record.decision === 'approved' &&
              statusActions(record.registry_state).includes(record.action);
            await client.query(
              `
              UPDATE certificate_status_proposals SET onchain_proposal_id = $2, onchain_contract = $3,
                onchain_chain_id = $4, onchain_state = $5, delivery_attempted_at = clock_timestamp(), delivery_failed = false,
                delivery_uncertain = false,
                applied_at = CASE WHEN $5 = 'executed' AND $6::boolean THEN clock_timestamp() END,
                closed_at = CASE WHEN $5 IN ('cancelled', 'expired') THEN clock_timestamp() END,
                withdrawal_completed_at = CASE WHEN withdrawal_requested_at IS NOT NULL
                  AND $5 IN ('cancelled', 'expired') THEN clock_timestamp() END
              WHERE id = $1
            `,
              [id, result.id, governance.contract, governance.chainId, result.state, canApply],
            );
            if (result.state === 'executed' && canApply) {
              // A later decision may already have changed the standing again.
              // Invalidate the observation and let the ledger reader refresh it.
              await client.query(
                `
                UPDATE registered_certificates SET local_standing = $2, ledger_standing = NULL, ledger_observed_at = NULL,
                  ledger_observation_invalidated_at = clock_timestamp() WHERE id = $1
              `,
                [
                  record.certificate_id,
                  record.action === 'suspend'
                    ? 'suspended'
                    : record.action === 'revoke'
                      ? 'revoked'
                      : 'active',
                ],
              );
              if (record.action === 'reinstate' || record.action === 'revoke')
                await client.query(
                  'UPDATE certificate_emergency_suspensions SET applied_at=clock_timestamp() WHERE certificate_id=$1 AND applied_at IS NULL',
                  [record.certificate_id],
                );
            }
            if (result.state === 'executed' && canApply) {
              const authorNames = (
                await client.query(
                  'SELECT id,username FROM operator_accounts WHERE id=ANY($1::int[])',
                  [[record.proposed_by, record.decided_by]],
                )
              ).rows;
              const applied = (
                await client.query(
                  'SELECT applied_at FROM certificate_status_proposals WHERE id=$1',
                  [id],
                )
              ).rows[0];
              await anchorDecision(client, protection, {
                kind: 'status_change',
                certificate: record.certificate_id,
                credentialId: record.credential_id,
                proposal: id,
                decision: {
                  certificate: record.certificate_id,
                  credential_id: record.credential_id,
                  proposal: id,
                  action: record.action,
                  from_state: record.registry_state,
                  to_state:
                    record.action === 'suspend'
                      ? 'suspended'
                      : record.action === 'revoke'
                        ? 'revoked'
                        : 'active',
                  proposed_by:
                    authorNames.find((row) => row.id === record.proposed_by)?.username ?? null,
                  approved_by:
                    authorNames.find((row) => row.id === record.decided_by)?.username ?? null,
                  reason_code: record.reason_code,
                  reason_note: privateReason.note,
                  reason_hash: record.reason_hash.toString('hex'),
                  onchain_proposal_id: result.id,
                  decided_at: applied.applied_at,
                },
              });
            }
            if (record.onchain_state !== result.state || record.onchain_proposal_id !== result.id) {
              const event =
                result.state === 'executed' && canApply
                  ? 'status.change_applied'
                  : result.state === 'cancelled'
                    ? 'governance.cancelled'
                    : result.state === 'expired'
                      ? 'governance.expired'
                      : 'governance.progress';
              await appendAudit(client, {
                event,
                credentialId: record.credential_id,
                proposalId: id,
                detail: {
                  action: record.action,
                  ...(result.state === 'executed' && canApply
                    ? {
                        from_state: record.registry_state,
                        to_state:
                          record.action === 'suspend'
                            ? 'suspended'
                            : record.action === 'revoke'
                              ? 'revoked'
                              : 'active',
                      }
                    : {}),
                  onchain_proposal_id: result.id,
                  state: result.state,
                  chain_id: governance.chainId,
                  contract: governance.contract,
                  reason_hash: '0x' + expectedReason.toString('hex'),
                },
              });
            }
            await client.query('RELEASE SAVEPOINT delivery');
          } catch (error) {
            failure = error;
            await client.query('ROLLBACK TO SAVEPOINT delivery');
            await client.query(
              `
              UPDATE certificate_status_proposals SET delivery_attempted_at = clock_timestamp(), delivery_failed = true
              WHERE id = $1
            `,
              [id],
            );
            if (!record.delivery_failed)
              await appendAudit(client, {
                event: 'governance.delivery_failed',
                credentialId: record.credential_id,
                proposalId: id,
                detail: { withdrawal: Boolean(record.withdrawal_requested_at) },
              });
          }
        });
      } catch (error) {
        failure = error;
        await database.query(
          `
          UPDATE certificate_status_proposals SET delivery_attempted_at = clock_timestamp(), delivery_failed = true
          WHERE id = $1 AND applied_at IS NULL AND closed_at IS NULL
        `,
          [id],
        );
      }
    }
    if (proposalId && failure) throw failure;
    return progress;
  }
  return deliverApprovedCases;
}
