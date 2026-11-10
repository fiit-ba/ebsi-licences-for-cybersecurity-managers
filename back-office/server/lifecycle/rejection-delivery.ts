import { GovernanceUnavailable } from './governance.ts';
import { openReason } from './reason-storage.ts';
import type { Pool } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { reasonCommitment, type Protection } from '../issuance/protection.ts';
import type { GovernanceActions } from './governance.ts';

/**
 * Retry the veto of a locally rejected case independently of local approval.
 * @param database - PostgreSQL pool.
 * @param governance - Exact pinned proposal/cancellation adapter.
 * @param protection - Private reason decryption.
 * @returns A bounded worker preserving rejection even when external execution wins the race.
 */
export function postgresRejectionDelivery(
  database: Pool,
  governance: GovernanceActions,
  protection: Protection,
) {
  /**
   * Read the original contract and veto only the exact rejected proposal.
   * @param proposalId - Optional concrete rejected case; omission retains a bounded batch.
   * @returns Completion after at most twenty requests; uncertain RPC effects remain retryable.
   * @throws Database errors when retry bookkeeping or audit cannot be persisted.
   */
  return async function deliverRejections(proposalId?: string) {
    let failure: unknown;
    const rows = (
      await database.query(
        `SELECT id FROM certificate_status_proposals WHERE rejected_at IS NOT NULL
      AND rejection_delivered_at IS NULL AND onchain_contract IS NOT NULL
      AND ($1::uuid IS NULL OR id=$1)
      AND ($1::uuid IS NOT NULL OR delivery_attempted_at IS NULL OR delivery_attempted_at<clock_timestamp()-interval '15 seconds')
      ORDER BY delivery_attempted_at NULLS FIRST,proposed_at,id LIMIT 20`,
        [proposalId ?? null],
      )
    ).rows;
    for (const { id } of rows)
      await transaction(database, async (client) => {
        const target = (
          await client.query(
            'SELECT certificate_id FROM certificate_status_proposals WHERE id=$1',
            [id],
          )
        ).rows[0];
        if (!target) return;
        if (
          !(
            await client.query(
              'SELECT id FROM registered_certificates WHERE id=$1 FOR UPDATE SKIP LOCKED',
              [target.certificate_id],
            )
          ).rowCount
        )
          return;
        const record = (
          await client.query(
            `SELECT p.*,c.credential_id,c.issuer_did,c.certificate_number,c.status_key,c.credential_hash
        FROM certificate_status_proposals p JOIN registered_certificates c ON c.id=p.certificate_id
        WHERE p.id=$1 AND p.rejected_at IS NOT NULL AND p.rejection_delivered_at IS NULL
        AND ($2::boolean OR p.delivery_attempted_at IS NULL OR p.delivery_attempted_at<clock_timestamp()-interval '15 seconds') FOR UPDATE OF p`,
            [id, Boolean(proposalId)],
          )
        ).rows[0];
        if (!record) return;
        await client.query(
          'UPDATE certificate_status_proposals SET delivery_attempted_at=clock_timestamp() WHERE id=$1',
          [id],
        );
        let result;
        try {
          if (
            record.onchain_contract !== governance.contract ||
            Number(record.onchain_chain_id) !== governance.chainId
          )
            return;
          const privateReason = await openReason(record, protection);
          const hash = reasonCommitment(privateReason.code, privateReason.note, privateReason.salt);
          if (!hash.equals(record.reason_hash))
            throw new Error('The rejected reason no longer matches its commitment.');
          const rejection = (
            await client.query(
              "SELECT entry_hash FROM audit_entries WHERE proposal_id=$1 AND event='status.change_rejected' ORDER BY id DESC LIMIT 1",
              [id],
            )
          ).rows[0];
          if (!rejection) throw new Error('The rejection evidence is missing.');
          result = await governance
            .withdraw(
              {
                action: record.action,
                reasonHash: '0x' + hash.toString('hex'),
                onchainId: record.onchain_proposal_id,
                statusKey: '0x' + record.status_key.toString('hex'),
                credentialId: record.credential_id,
                issuerDid: record.issuer_did,
                credentialHash: '0x' + record.credential_hash.toString('hex'),
              },
              '0x' + rejection.entry_hash.toString('hex'),
            )
            .catch(() => {
              throw new GovernanceUnavailable();
            });
        } catch (error) {
          failure = error;
          return;
        }
        await client.query(
          `UPDATE certificate_status_proposals SET onchain_proposal_id=$2,onchain_state=$3,
        rejection_delivered_at=CASE WHEN $3 IN ('executed','cancelled','expired') THEN clock_timestamp() END,
        delivery_uncertain=false WHERE id=$1`,
          [id, result.id, result.state],
        );
        if (record.onchain_state !== result.state)
          await appendAudit(client, {
            event: 'governance.progress',
            credentialId: record.credential_id,
            proposalId: id,
            detail: {
              action: record.action,
              onchain_proposal_id: result.id,
              state: result.state,
              chain_id: governance.chainId,
              contract: governance.contract,
              reason_hash: '0x' + record.reason_hash.toString('hex'),
            },
          });
      });
    if (proposalId && failure) throw failure;
  };
}
