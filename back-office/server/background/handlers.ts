import { GovernanceUnavailable } from '../lifecycle/governance.ts';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Domains } from '../runtime.ts';
import { purgeUnusedSigningIntents } from '../keys/ledger-signing.ts';
import { enqueue, taskOptions, type backgroundQueue } from './queue.ts';
import { ProposalPending, type BackgroundTask } from './types.ts';
import { UnrecoverableError } from 'bullmq';

/**
 * Dispatch existing domain work from current PostgreSQL state, never from a decision in Redis.
 * @param database - Process-owned pool; domain handlers keep their existing row/advisory locks.
 * @param domains - Current domain services, composed without the HTTP entry point.
 * @param queue - Producer used for concrete follow-up work and timelock delays.
 * @returns The BullMQ processor's identifier-only dispatch operation.
 */
export function backgroundHandlers(
  database: Pool,
  domains: Domains,
  queue: ReturnType<typeof backgroundQueue>,
) {
  const submit = (task: BackgroundTask, delay = 0) => enqueue(queue, task, delay);
  /**
   * Expand a governance safety sweep into its original per-case tasks.
   * @returns Completion after pending cases, withdrawals and existing TS recovery work are queued.
   * @throws Broker/database errors; the next scheduled sweep retries remaining work.
   */
  async function sweepGovernance() {
    if (domains.issuer) {
      const rows = (
        await database.query(`SELECT p.id,p.onchain_proposal_id,p.withdrawal_requested_at,p.rejected_at,
        EXISTS(SELECT 1 FROM organization_case_cancellations x WHERE x.proposal_id=p.id AND x.completed_at IS NULL) AS cancelling
        FROM certificate_status_proposals p WHERE p.requires_governance AND (
          (p.applied_at IS NULL AND p.closed_at IS NULL AND p.rejected_at IS NULL)
          OR (p.rejected_at IS NOT NULL AND p.rejection_delivered_at IS NULL AND p.onchain_contract IS NOT NULL)
          OR EXISTS(SELECT 1 FROM organization_case_cancellations x WHERE x.proposal_id=p.id AND x.completed_at IS NULL))
        ORDER BY p.proposed_at,p.id`)
      ).rows;
      for (const row of rows)
        await submit({
          operation:
            row.withdrawal_requested_at || row.rejected_at || row.cancelling
              ? 'withdraw-governance-proposal'
              : row.onchain_proposal_id
                ? 'reconcile-governance-proposal'
                : 'submit-governance-proposal',
          proposalId: row.id,
        });
    }
    // Recover pending mail and accreditation withdrawals during the governance safety sweep.
    if (domains.passwordRecovery) {
      const rows = (
        await database.query(`SELECT DISTINCT account_id FROM operator_password_resets WHERE expires_at>clock_timestamp()
        AND (delivered_at IS NULL OR delivered_at<requested_at) ORDER BY account_id`)
      ).rows;
      for (const row of rows)
        await submit({ operation: 'send-recovery', accountId: row.account_id });
      await domains.passwordRecovery.purgeExpired();
    }
    const rows = (
      await database.query(
        `SELECT DISTINCT revoked_organization_id FROM accreditation_withdrawals WHERE tir_completed_at IS NULL ORDER BY revoked_organization_id`,
      )
    ).rows;
    for (const row of rows)
      await submit({
        operation: 'withdraw-accreditation',
        organizationId: row.revoked_organization_id,
      });
    await domains.issuer?.governance.reconcileSignatures();
  }

  /**
   * Queue a bounded standing sweep and refresh emergency and ledger observations.
   * @returns Completion after at most 200 identifiers are submitted with a 300-second lease.
   * @throws Broker/database errors; leases use BullMQ deduplication, never a new durable status.
   */
  async function sweepStanding() {
    if (!domains.issuer) return;
    const rows = (
      await database.query(`SELECT c.id FROM registered_certificates c
      JOIN credential_tokens t ON t.certificate_id=c.id AND t.redeemed_at IS NOT NULL
      WHERE c.registered_id IS NOT NULL AND (c.ledger_registered_at IS NULL OR EXISTS (
        SELECT 1 FROM certificate_emergency_suspensions e WHERE e.certificate_id=c.id AND e.applied_at IS NULL))
      ORDER BY c.created_at,c.id LIMIT 400`)
    ).rows;
    let queued = 0;
    for (const row of rows) {
      const task: BackgroundTask = { operation: 'record-standing', certificateId: row.id };
      // Sweep jobs use ordinary priority; immediate collection and emergency jobs use urgent priority.
      const jobId = randomUUID();
      const job = await queue.add(task.operation, task, {
        ...taskOptions(task),
        jobId,
        priority: 2,
        deduplication: { id: 'standing-' + row.id, ttl: 300_000 },
      });
      if (job.id === jobId) queued++;
      if (queued >= 200) break;
    }
    await domains.issuer.refreshStanding();
  }

  /**
   * Validate identifier-only payloads and invoke the matching existing operation.
   * @param task - Broker payload; extra/private properties are refused before dispatch.
   * @returns Completion when the domain call finishes, which need not mean blockchain confirmation.
   * @throws Domain/provider errors for BullMQ retries, or UnrecoverableError for malformed work.
   */
  async function handle(task: BackgroundTask) {
    const fields: Record<string, string | undefined> = {
      'record-standing': 'certificateId',
      'submit-governance-proposal': 'proposalId',
      'submit-governance-signature': 'proposalId',
      'reconcile-governance-proposal': 'proposalId',
      'withdraw-governance-proposal': 'proposalId',
      'submit-timestamp': 'anchorId',
      'send-recovery': 'accountId',
      'withdraw-accreditation': 'organizationId',
      'onboard-issuer': 'organizationId',
      'sweep-governance': undefined,
      'sweep-standing': undefined,
      'sweep-timestamps': undefined,
      'purge-signing-intents': undefined,
      'purge-presentation-attributes': undefined,
      'revalidate-accreditation': undefined,
    };
    if (!task || !Object.hasOwn(fields, task.operation))
      throw new UnrecoverableError('Unknown background operation.');
    const field = fields[task.operation];
    if (Object.keys(task).some((key) => key !== 'operation' && key !== field))
      throw new UnrecoverableError('Unexpected background payload.');
    const id = field ? (task as unknown as Record<string, unknown>)[field] : undefined;
    if (
      field &&
      (field === 'accountId'
        ? !Number.isSafeInteger(id) || Number(id) <= 0
        : typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    )
      throw new UnrecoverableError('Invalid background identifier.');
    switch (task.operation) {
      case 'record-standing':
        try {
          await domains.issuer?.deliverRegistrations(task.certificateId);
          await domains.issuer?.deliverEmergencySuspensions(task.certificateId);
        } catch (error) {
          if (error instanceof GovernanceUnavailable) throw error;
          throw new UnrecoverableError('Certificate standing integrity check failed.');
        }
        return;
      case 'submit-governance-proposal':
      case 'submit-governance-signature':
      case 'reconcile-governance-proposal':
      case 'withdraw-governance-proposal': {
        if (!domains.issuer?.deliverApprovedCases) return;
        const row = (
          await database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
            task.proposalId,
          ])
        ).rows[0];
        if (!row || !row.requires_governance) return;
        const withdrawing = task.operation === 'withdraw-governance-proposal';
        if (!withdrawing && (row.applied_at || row.closed_at || row.rejected_at)) return;
        if (task.operation === 'submit-governance-signature' && row.decision !== 'approved') return;
        if (task.operation === 'submit-governance-signature' && !row.onchain_proposal_id) {
          await submit({ operation: 'submit-governance-proposal', proposalId: task.proposalId });
          throw new ProposalPending();
        }
        const phase = withdrawing
          ? 'withdraw'
          : task.operation === 'submit-governance-proposal'
            ? 'propose'
            : task.operation === 'submit-governance-signature'
              ? 'sign'
              : 'reconcile';
        let result;
        try {
          result = await domains.issuer.deliverApprovedCases(task.proposalId, phase);
        } catch (error) {
          if (error instanceof GovernanceUnavailable) throw error;
          throw new UnrecoverableError('Governance decision integrity check failed.');
        }
        if (!result || withdrawing) return;
        const current = (
          await database.query('SELECT decision FROM certificate_status_proposals WHERE id=$1', [
            task.proposalId,
          ])
        ).rows[0];
        if (current?.decision !== 'approved') return;
        if (result.state === 'proposed' && !result.approverSigned && phase !== 'sign')
          await submit({ operation: 'submit-governance-signature', proposalId: task.proposalId });
        else if (
          phase === 'sign' ||
          (phase === 'propose' && result.state === 'executed') ||
          (result.state === 'approved' && result.executableAt)
        )
          await submit(
            { operation: 'reconcile-governance-proposal', proposalId: task.proposalId },
            Math.max(0, (result.executableAt ?? 0) * 1000 - Date.now()),
          );
        return;
      }
      case 'submit-timestamp':
        return domains.timestamp?.deliver(task.anchorId);
      case 'send-recovery':
        return domains.passwordRecovery?.deliver(task.accountId);
      case 'withdraw-accreditation':
        return domains.organizations.withdrawals.deliver(task.organizationId);
      case 'onboard-issuer': {
        // The payload names only the TI; its own account is the one that registered it.
        const {
          rows: [organization],
        } = await database.query('SELECT account_id FROM accredited_organizations WHERE id=$1', [
          task.organizationId,
        ]);
        return domains.organizations.onboarding.onboard(
          task.organizationId,
          organization?.account_id ?? undefined,
        );
      }
      case 'sweep-governance':
        return sweepGovernance();
      case 'sweep-standing':
        return sweepStanding();
      case 'sweep-timestamps': {
        if (!domains.timestamp) return;
        const rows = (
          await database.query(
            `SELECT id FROM audit_anchors WHERE confirmed_at IS NULL AND (raw_transaction IS NOT NULL OR attempts<50) ORDER BY created_at,id`,
          )
        ).rows;
        for (const row of rows) await submit({ operation: 'submit-timestamp', anchorId: row.id });
        return;
      }
      case 'purge-signing-intents':
        return purgeUnusedSigningIntents(database);
      case 'purge-presentation-attributes':
        return domains.issuer?.verification.purgeAttributes();
      case 'revalidate-accreditation':
        return domains.organizations.accreditation.revalidateAll();
    }
  }
  return handle;
}
