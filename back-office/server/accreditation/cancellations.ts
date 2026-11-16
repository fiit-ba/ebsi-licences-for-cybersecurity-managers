import { enqueueAfterCommit } from '../background/queue.ts';
import { GovernanceUnavailable } from '../lifecycle/governance.ts';
import { openReason, storeReason } from '../lifecycle/reason-storage.ts';
import type { Pool } from 'pg';
import type { GovernanceActions, GovernanceProgress } from '../lifecycle/governance.ts';
import type { Protection } from '../issuance/protection.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import { transaction } from '../adapters/transaction.ts';
import { randomBytes } from 'node:crypto';
import { appendAudit } from '../audit/journal.ts';

/**
 * Deliver cancellations of superseded nonrevocation cases after organization revocation.
 * @param database - PostgreSQL pool.
 * @param governance - Original pinned governance deployment and exact-case cancellation adapter.
 * @param protection - Private reason decryption.
 * @returns A bounded retry worker, serialized against certificate decision delivery.
 */
export function postgresOrganizationCancellations(
  database: Pool,
  governance: GovernanceActions,
  protection: Protection,
) {
  /**
   * Cancel or reconcile the original case without signing or creating a new on-chain decision.
   * @param proposalId - Optional concrete case; omission retains the bounded compatibility batch.
   * @returns Completion after at most twenty requests; provider failures retain durable pending work.
   * @throws Database errors if failure bookkeeping cannot be stored.
   */
  return async function deliverCancellations(proposalId?: string) {
    let failure: unknown;
    const { rows } = await database.query(
      `SELECT proposal_id FROM organization_case_cancellations WHERE completed_at IS NULL AND ($1::uuid IS NULL OR proposal_id=$1) AND ($1::uuid IS NOT NULL OR attempted_at IS NULL OR attempted_at<clock_timestamp()-interval '15 seconds') ORDER BY attempted_at NULLS FIRST,proposal_id LIMIT 20`,
      [proposalId ?? null],
    );
    for (const row of rows)
      await transaction(database, async (client) => {
        const target = (
          await client.query(
            'SELECT certificate_id FROM certificate_status_proposals WHERE id=$1',
            [row.proposal_id],
          )
        ).rows[0];
        if (!target) return;
        await client.query('SELECT id FROM registered_certificates WHERE id=$1 FOR UPDATE', [
          target.certificate_id,
        ]);
        const record = (
          await client.query(
            `SELECT p.*,c.issuer_did,c.certificate_number,c.credential_id,c.status_key,c.credential_hash,x.requested_by,x.reason_salt AS cancellation_salt,x.reason_hash AS cancellation_hash
        FROM organization_case_cancellations x JOIN certificate_status_proposals p ON p.id=x.proposal_id JOIN registered_certificates c ON c.id=p.certificate_id
        WHERE x.proposal_id=$1 AND x.completed_at IS NULL AND ($2::boolean OR x.attempted_at IS NULL OR x.attempted_at<clock_timestamp()-interval '15 seconds') FOR UPDATE OF x,p`,
            [row.proposal_id, Boolean(proposalId)],
          )
        ).rows[0];
        if (!record) return;
        await client.query(
          'UPDATE organization_case_cancellations SET attempted_at=clock_timestamp() WHERE proposal_id=$1',
          [row.proposal_id],
        );
        let result: GovernanceProgress;
        try {
          if (
            record.onchain_contract !== governance.contract ||
            Number(record.onchain_chain_id) !== governance.chainId
          )
            throw new Error('The superseded case belongs to another deployment.');
          const privateCancellation = await openReason(
            {
              reason_code: 'issuer_revoked',
              reason_note: '',
              reason_salt: record.cancellation_salt,
              reason_hash: record.cancellation_hash,
            },
            protection,
          );
          const cancellation = reasonCommitment('issuer_revoked', '', privateCancellation.salt);
          const privateReason = await openReason(record, protection);
          const reason = reasonCommitment(
            privateReason.code,
            privateReason.note,
            privateReason.salt,
          );
          if (!cancellation.equals(record.cancellation_hash) || !reason.equals(record.reason_hash))
            throw new Error('Case commitments changed.');
          result = await governance
            .withdraw(
              {
                action: record.action,
                reasonHash: '0x' + reason.toString('hex'),
                onchainId: record.onchain_proposal_id,
                statusKey: '0x' + record.status_key.toString('hex'),
                credentialId: record.credential_id,
                issuerDid: record.issuer_did,
                credentialHash: '0x' + record.credential_hash.toString('hex'),
              },
              '0x' + cancellation.toString('hex'),
            )
            .catch(() => {
              throw new GovernanceUnavailable();
            });
        } catch (error) {
          failure = error;
          // Preserve the committed attempt and retry exact-case reconciliation.
          return;
        }
        if (result.state === 'executed' && record.action === 'reinstate') {
          // Execution can beat cancellation after an earlier protective write.
          // A new salted emergency must not reconcile to that earlier event.
          const salt = randomBytes(32);
          const storedReason = await storeReason('issuer_revoked', '', salt, protection);
          const hash = storedReason.reason_hash;
          const emergency = await client.query(
            `INSERT INTO certificate_emergency_suspensions(certificate_id,requested_by,reason_code,reason_note,reason_salt,reason_hash)
            VALUES($1,$2,'issuer_revoked',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
            [
              record.certificate_id,
              record.requested_by,
              storedReason.reason_note,
              storedReason.reason_salt,
              hash,
            ],
          );
          await client.query(
            `UPDATE registered_certificates SET local_standing='suspended',ledger_standing=NULL,ledger_observed_at=NULL,ledger_observation_invalidated_at=clock_timestamp() WHERE id=$1`,
            [record.certificate_id],
          );
          if (emergency.rowCount)
            enqueueAfterCommit(client, {
              operation: 'record-standing',
              certificateId: record.certificate_id,
            });
          if (emergency.rowCount)
            await appendAudit(client, {
              event: 'status.emergency_suspension',
              actor: record.requested_by,
              credentialId: record.credential_id,
              detail: {
                emergency_id: emergency.rows[0].id,
                reason_hash: '0x' + hash.toString('hex'),
              },
            });
        }
        await client.query(
          'UPDATE certificate_status_proposals SET onchain_state=$2,delivery_uncertain=false WHERE id=$1',
          [row.proposal_id, result.state],
        );
        if (['cancelled', 'expired', 'executed'].includes(result.state))
          await client.query(
            'UPDATE organization_case_cancellations SET completed_at=clock_timestamp() WHERE proposal_id=$1',
            [row.proposal_id],
          );
      });
    if (proposalId && failure) throw failure;
  };
}
