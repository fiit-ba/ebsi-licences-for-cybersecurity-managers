import { enqueueAfterCommit } from '../background/queue.ts';
import { storeReason } from '../lifecycle/reason-storage.ts';
import { anchorDecision } from '../audit/decisions.ts';
import type { Protection } from '../issuance/protection.ts';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { reasonCommitment } from '../issuance/protection.ts';

/**
 * Protect certificates and open independent revocation cases within the hierarchy transaction.
 * @param client - Transaction that already locked the revoked organization branch.
 * @param organizations - Affected organization UUIDs.
 * @param actor - Operator who revoked their accreditation.
 * @param governanceEnabled - Existing collected-certificate execution policy.
 * @param protection - Installation encryption key for the private decision snapshot.
 * @returns Numbers of newly suspended certificates and proposed revocations.
 * @throws Database or audit errors, rolling back the revocation and its local protective effects.
 * @remarks Existing revocation cases survive. Other open cases are closed before a replacement is created. No approval or ledger revocation is fabricated.
 */
export async function withdrawOrganizationCertificates(
  client: PoolClient,
  organizations: string[],
  actor: number,
  governanceEnabled: boolean,
  protection?: Protection,
) {
  const { rows: certificates } = await client.query(
    `
    SELECT c.*, EXISTS(SELECT 1 FROM credential_tokens t WHERE t.certificate_id=c.id AND t.redeemed_at IS NOT NULL) AS collected
    FROM registered_certificates c WHERE issuer_id=ANY($1::uuid[]) AND local_standing<>'revoked' ORDER BY c.id FOR UPDATE OF c
  `,
    [organizations],
  );
  let suspended = 0;
  let proposed = 0;
  for (const certificate of certificates) {
    let open = (
      await client.query(
        `SELECT * FROM certificate_status_proposals WHERE certificate_id=$1 AND applied_at IS NULL AND closed_at IS NULL AND decision IS DISTINCT FROM 'rejected' FOR UPDATE`,
        [certificate.id],
      )
    ).rows[0];
    if (open && open.action !== 'revoke') {
      // A submitted case is no longer locally approvable. Its independent on-chain
      // reconciliation still belongs to the existing governance delivery service.
      await client.query(
        'UPDATE certificate_status_proposals SET closed_at=clock_timestamp() WHERE id=$1',
        [open.id],
      );
      if (open.onchain_proposal_id || open.delivery_uncertain) {
        const cancellationSalt = randomBytes(32);
        const cancellationReason = await storeReason(
          'issuer_revoked',
          '',
          cancellationSalt,
          protection,
        );
        await client.query(
          'INSERT INTO organization_case_cancellations(proposal_id,requested_by,reason_salt,reason_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [open.id, actor, cancellationReason.reason_salt, cancellationReason.reason_hash],
        );
        enqueueAfterCommit(client, {
          operation: 'withdraw-governance-proposal',
          proposalId: open.id,
        });
      }
      await appendAudit(client, {
        event: 'status.change_rejected',
        actor,
        credentialId: certificate.credential_id,
        proposalId: open.id,
        detail: { action: open.action, reason_hash: '0x' + open.reason_hash.toString('hex') },
      });
      open = undefined;
    }
    if (certificate.local_standing === 'active') {
      const salt = randomBytes(32);
      const storedReason = await storeReason('issuer_revoked', '', salt, protection);
      const hash = storedReason.reason_hash;
      const emergency = await client.query(
        `INSERT INTO certificate_emergency_suspensions(certificate_id,requested_by,reason_code,reason_note,reason_salt,reason_hash,applied_at)
        VALUES($1,$2,'issuer_revoked',$3,$4,$5,CASE WHEN $6 THEN clock_timestamp() END) ON CONFLICT DO NOTHING RETURNING id`,
        [
          certificate.id,
          actor,
          storedReason.reason_note,
          storedReason.reason_salt,
          hash,
          !governanceEnabled || !certificate.collected,
        ],
      );
      await client.query(
        "UPDATE registered_certificates SET local_standing='suspended' WHERE id=$1",
        [certificate.id],
      );
      if (governanceEnabled && certificate.collected)
        enqueueAfterCommit(client, { operation: 'record-standing', certificateId: certificate.id });
      if (emergency.rowCount) {
        suspended++;
        if (protection) {
          const author = (
            await client.query('SELECT username FROM operator_accounts WHERE id=$1', [actor])
          ).rows[0];
          await anchorDecision(client, protection, {
            kind: 'emergency_suspension',
            certificate: certificate.id,
            credentialId: certificate.credential_id,
            proposal: emergency.rows[0].id,
            decision: {
              certificate: certificate.id,
              credential_id: certificate.credential_id,
              proposal: emergency.rows[0].id,
              action: 'suspend',
              decided_by: author.username,
              reason_code: 'issuer_revoked',
              reason_note: '',
              decided_at: new Date(),
            },
          });
        }
        await appendAudit(client, {
          event: 'status.emergency_suspension',
          actor,
          credentialId: certificate.credential_id,
          proposalId: emergency.rows[0].id,
          detail: {
            emergency_id: emergency.rows[0].id,
            action: 'suspend',
            from_state: 'active',
            to_state: 'suspended',
            reason_code: 'issuer_revoked',
            emergency: true,
            reason_hash: '0x' + hash.toString('hex'),
          },
        });
      }
    }
    if (open?.action === 'revoke' && !open.decision) {
      await client.query(
        "UPDATE certificate_status_proposals SET initial_standing='suspended' WHERE id=$1",
        [open.id],
      );
    }
    if (!open) {
      const salt = randomBytes(32);
      const storedReason = await storeReason('issuer_revoked', '', salt, protection);
      const hash = storedReason.reason_hash;
      const {
        rows: [proposal],
      } = await client.query(
        `INSERT INTO certificate_status_proposals(certificate_id,action,initial_standing,reason_code,reason_note,reason_salt,reason_hash,proposed_by,requires_governance)
        VALUES($1,'revoke','suspended','issuer_revoked',$2,$3,$4,$5,$6) RETURNING id`,
        [
          certificate.id,
          storedReason.reason_note,
          storedReason.reason_salt,
          hash,
          actor,
          // A revoked TI can neither propose nor execute on the governance contract, only
          // suspend at once: its certificates stay SUSPENDED on chain (the contract's D43),
          // and this revocation is the registry's own decision.
          false,
        ],
      );
      proposed++;
      await appendAudit(client, {
        event: 'status.change_proposed',
        actor,
        credentialId: certificate.credential_id,
        proposalId: proposal.id,
        detail: {
          action: 'revoke',
          initial_standing: 'suspended',
          from_state: 'suspended',
          reason_code: 'issuer_revoked',
          emergency: false,
          reason_hash: '0x' + hash.toString('hex'),
        },
      });
    }
  }
  return { suspended, revocations_proposed: proposed };
}

/**
 * Create bounded, retryable TIR withdrawal delivery for committed accreditation decisions.
 * @param database - PostgreSQL pool.
 * @param revoke - Revokes one organization's TIR attribute as its accreditor (development
 * publication); omitted for manual real-EBSI operation.
 * @returns A delivery worker and an immediate branch-delivery operation.
 * @remarks Local certificate protection is committed by the caller. TIR acknowledgement does not mean certificate governance has executed.
 */
export function postgresAccreditationWithdrawal(
  database: Pool,
  revoke?: (organizationId: string) => Promise<void>,
) {
  /**
   * Acknowledge pending TIR revocations without losing failed work.
   * @param branch - Optional revoked branch UUID for immediate delivery.
   * @returns Completion after a bounded batch; provider errors remain pending.
   * @throws Database errors if delivery bookkeeping fails.
   */
  async function deliver(branch?: string) {
    if (!revoke) return;
    let failed = false;
    const { rows } = await database.query(
      `SELECT revoked_organization_id,affected_organization_id FROM accreditation_withdrawals
      WHERE tir_completed_at IS NULL AND ($1::uuid IS NULL OR revoked_organization_id=$1)
        AND (attempted_at IS NULL OR attempted_at<clock_timestamp()-interval '15 seconds')
      ORDER BY requested_at,affected_organization_id LIMIT 20`,
      [branch ?? null],
    );
    for (const row of rows) {
      await transaction(database, async (client) => {
        const {
          rows: [work],
        } = await client.query(
          `SELECT w.*,o.did FROM accreditation_withdrawals w JOIN accredited_organizations o ON o.id=w.affected_organization_id
          WHERE revoked_organization_id=$1 AND affected_organization_id=$2 AND tir_completed_at IS NULL
            AND (attempted_at IS NULL OR attempted_at<clock_timestamp()-interval '15 seconds') FOR UPDATE OF w SKIP LOCKED`,
          [row.revoked_organization_id, row.affected_organization_id],
        );
        if (!work) return;
        await client.query(
          'UPDATE accreditation_withdrawals SET attempted_at=clock_timestamp() WHERE revoked_organization_id=$1 AND affected_organization_id=$2',
          [row.revoked_organization_id, row.affected_organization_id],
        );
        try {
          if (work.did) await revoke(row.affected_organization_id);
        } catch {
          failed = true;
          return;
        }
        await client.query(
          'UPDATE accreditation_withdrawals SET tir_completed_at=clock_timestamp() WHERE revoked_organization_id=$1 AND affected_organization_id=$2',
          [row.revoked_organization_id, row.affected_organization_id],
        );
      });
    }
    if (branch && failed) throw new Error('Accreditation withdrawal unavailable.');
  }
  return { deliver };
}
