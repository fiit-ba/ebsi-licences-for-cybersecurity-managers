import { enqueueAfterCommit } from '../background/queue.ts';
import { lifecycleRefusal, lifecycleIdentifier } from './refusal.ts';
import { openReason, storeReason } from './reason-storage.ts';
import { anchorDecision } from '../audit/decisions.ts';
import type { Protection } from '../issuance/protection.ts';
import {
  certificateOrganizations,
  lockStatusManager,
  lifecycleStanding,
  statusManagerAccess,
} from './access.ts';
import { randomBytes } from 'node:crypto';
import { authorizeGovernance } from './governance-access.ts';
import { appendAudit } from '../audit/journal.ts';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import { statusReasons as reasons, maxReasonCharacters } from '../../shared/certificate-status.ts';
import { trimIdentityField } from '../identity/input-text.ts';

/** Supported certificate-status transition selected from the shared reason catalog. */
type Action = keyof typeof reasons;

/**
 * List lifecycle actions allowed from committed certificate state.
 *
 * @param standing - Committed active, suspended or terminal state.
 * @returns Allowed action names; unknown and terminal states return an empty list.
 */
export function statusActions(standing: string): Action[] {
  if (standing === 'active') return ['suspend', 'revoke'];
  if (standing === 'suspended') return ['reinstate', 'revoke'];
  return [];
}

/**
 * Throw an HTTP-compatible lifecycle refusal.
 *
 * @param status - HTTP status.
 * @param reason - Stable refusal code.
 * @param detail - Public explanation.
 * @returns Never returns.
 * @throws IssuanceError for the supplied refusal.
 */
function fail(status: number, reason: string, detail: string): never {
  throw new IssuanceError(status, reason, detail);
}

/**
 * Validate and normalize a reason for a specific status action.
 *
 * @param action - Known status action.
 * @param input - Untrusted reason_code and reason_note fields.
 * @returns The allowed reason code and trimmed note.
 * @throws IssuanceError when the reason is invalid, a required note is missing or the note exceeds
 * 500 Unicode characters.
 */
export function statusReason(action: Action, input: Record<string, unknown>) {
  const code = input.reason_code;
  const allReasons = [...new Set(Object.values(reasons).flat())];
  if (code === null) throw lifecycleRefusal(400, { reason_code: ['This field may not be null.'] });
  if (code !== undefined && code !== '' && !allReasons.includes(String(code)))
    throw lifecycleRefusal(400, { reason_code: ['"' + String(code) + '" is not a valid choice.'] });
  const reason = code === undefined || code === '' ? 'none' : String(code);
  const suppliedNote = input.reason_note;
  if (suppliedNote === null)
    throw lifecycleRefusal(400, { reason_note: ['This field may not be null.'] });
  if (
    suppliedNote !== undefined &&
    typeof suppliedNote !== 'string' &&
    !(typeof suppliedNote === 'number' && Number.isFinite(suppliedNote))
  )
    throw lifecycleRefusal(400, { reason_note: ['Not a valid string.'] });
  const note = trimIdentityField(suppliedNote === undefined ? '' : String(suppliedNote));
  if (Array.from(note).length > maxReasonCharacters)
    throw lifecycleRefusal(400, {
      reason_note: ['Ensure this field has no more than 500 characters.'],
    });
  if (!reasons[action].includes(reason))
    throw lifecycleRefusal(400, {
      reason_code: [
        'A ' + action + ' needs one of these reasons: ' + reasons[action].join(', ') + '.',
      ],
    });
  if (reason === 'other' && !note)
    throw lifecycleRefusal(400, { reason_note: ['Say what the other reason is.'] });
  return { reason, note };
}

/**
 * Create registry-wide status proposals, independent decisions and withdrawals.
 *
 * @param database - PostgreSQL pool.
 * @param options - Whether decisions require governance; defaults to enabled.
 * @returns Transactional list, propose, decide and withdraw operations.
 */
export function postgresStatusProposals(
  database: Pool,
  options: { governanceEnabled?: boolean; protection?: Protection } = {},
) {
  const governanceEnabled = options.governanceEnabled ?? true;
  const standing = lifecycleStanding(governanceEnabled);
  return {
    governanceEnabled,
    /**
     * List open proposals visible to an authorized manager or auditor.
     *
     * @param actor - Operator account ID.
     * @param query - Bounded limit/offset parameters and optional exact proposal_id.
     * @returns Proposal rows with per-actor action permissions and total count.
     * @throws IssuanceError for an invalid proposal filter; database errors.
     */
    async list(actor: number, query: URLSearchParams) {
      const pageValue = (key: string, fallback: number, min: number, max: number) => {
        const raw = query.get(key);
        const value = raw && /^[+-]?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
        return Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
      };
      const limit = pageValue('limit', 200, 1, 1000);
      const offset = pageValue('offset', 0, 0, Number.MAX_SAFE_INTEGER - 1000);
      const proposalId = query.get('proposal_id');
      if (proposalId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(proposalId))
        fail(400, 'InvalidFields', 'Invalid proposal identifier.');
      return transaction(database, async (client: PoolClient) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const available = `
          FROM certificate_status_proposals p
          JOIN registered_certificates c ON c.id = p.certificate_id ${certificateOrganizations}
          WHERE p.applied_at IS NULL AND p.closed_at IS NULL AND p.decision IS DISTINCT FROM 'rejected'
            AND ($2::uuid IS NULL OR p.id = $2)
            AND ((${statusManagerAccess}) OR EXISTS (
              SELECT 1 FROM operator_accounts a JOIN operator_roles r ON r.account_id = a.id
              WHERE a.id = $1 AND a.active AND r.role = 'plr_auditor'
            ))
        `;
        const {
          rows: [count],
        } = await client.query(`SELECT count(*)::integer AS total ${available}`, [
          actor,
          proposalId || null,
        ]);
        const { rows: results } = await client.query(
          `
          SELECT p.id AS proposal_id, c.credential_id, c.certificate_number AS reference,
            c.id AS claims_certificate_id,c.private_data AS claims_private_data,
            p.action, p.reason_code, p.reason_note, p.reason_salt, p.reason_hash,
            (SELECT username FROM operator_accounts WHERE id = p.proposed_by) AS proposed_by,
            p.proposed_at, COALESCE(p.decision = 'approved', false) AS approved,
            p.onchain_proposal_id::text, p.onchain_state,
            p.withdrawal_requested_at IS NOT NULL AS withdrawal_pending,
            (${statusManagerAccess}) AS can_reject,
            COALESCE(p.decision = 'approved', false) AND p.withdrawal_requested_at IS NULL
              AND (${statusManagerAccess}) AS can_withdraw,
            p.decision IS NULL AND p.proposed_by <> $1
              AND (p.requires_governance = ${governanceEnabled} OR NOT p.requires_governance)
              AS can_approve
          ${available} ORDER BY p.proposed_at DESC, p.id DESC LIMIT $3 OFFSET $4
        `,
          [actor, proposalId || null, limit, offset],
        );
        return {
          results: await Promise.all(
            results.map(async (row) => {
              const privateReason = await openReason(row, options.protection);
              const { reason_salt, claims_certificate_id, claims_private_data, ...result } = row;
              const reference = options.protection
                ? ((await options.protection.open(claims_certificate_id, claims_private_data))
                    .claims.certificateNumber ?? '')
                : result.reference;
              return {
                ...result,
                reference,
                reason_note: privateReason.note,
                reason_hash: row.reason_hash.toString('hex'),
              };
            }),
          ),
          total: count.total,
        };
      });
    },

    /**
     * Withdraw an approved local case or queue cancellation of its pinned submission.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Local proposal ID and required withdrawal note.
     * @returns Immediate local withdrawal or a pending governance-cancellation response.
     * @throws IssuanceError for invalid IDs/notes, missing authority or closed/decided cases;
     * database errors.
     */
    async withdraw(actor: number, input: Record<string, unknown>) {
      const id = input.proposal_id;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
      }
      const note = typeof input.reason_note === 'string' ? input.reason_note.trim() : '';
      if (!note || Array.from(note).length > maxReasonCharacters)
        fail(400, 'InvalidReason', 'Enter a withdrawal note of up to 500 characters.');
      return transaction(database, async (client: PoolClient) => {
        const {
          rows: [target],
        } = await client.query(
          `
          SELECT c.id, c.issuer_id, c.credential_id FROM certificate_status_proposals p
          JOIN registered_certificates c ON c.id = p.certificate_id WHERE p.id = $1
        `,
          [id],
        );
        if (!target) throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
        await lockStatusManager(client, actor, target.issuer_id);
        await client.query('SELECT id FROM registered_certificates WHERE id = $1 FOR UPDATE', [
          target.id,
        ]);
        const {
          rows: [proposal],
        } = await client.query(
          `
          SELECT * FROM certificate_status_proposals WHERE id = $1 FOR UPDATE
        `,
          [id],
        );
        if (
          !proposal ||
          proposal.decision !== 'approved' ||
          proposal.applied_at ||
          proposal.closed_at ||
          proposal.withdrawal_requested_at
        )
          fail(409, 'ProposalDecided', 'Only an open approved proposal can be withdrawn once.');
        const local = proposal.onchain_contract === null;
        const salt = randomBytes(32);
        const storedWithdrawal = await storeReason('withdrawn', note, salt, options.protection);
        await client.query(
          `
          UPDATE certificate_status_proposals SET withdrawal_requested_at = clock_timestamp(),
            withdrawn_by = $2, withdrawal_note = $3, withdrawal_salt = $4, withdrawal_hash = $5,
            closed_at = CASE WHEN $6 THEN clock_timestamp() END,
            withdrawal_completed_at = CASE WHEN $6 THEN clock_timestamp() END,
            delivery_attempted_at = NULL WHERE id = $1
        `,
          [
            id,
            actor,
            storedWithdrawal.reason_note,
            storedWithdrawal.reason_salt,
            storedWithdrawal.reason_hash,
            local,
          ],
        );
        await appendAudit(client, {
          event: local ? 'status.change_withdrawn' : 'status.withdrawal_requested',
          actor,
          credentialId: target.credential_id,
          proposalId: id,
          detail: { reason_hash: '0x' + reasonCommitment('withdrawn', note, salt).toString('hex') },
        });
        if (!local)
          enqueueAfterCommit(client, { operation: 'withdraw-governance-proposal', proposalId: id });
        return local
          ? { proposal_id: id, withdrawn: true }
          : { proposal_id: id, withdrawal_requested: true, awaiting: 'governance contract' };
      });
    },

    /**
     * Create one pending status decision with a salted reason commitment.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Credential ID, transition action and reason fields.
     * @returns The proposal ID, requested action, initial standing and approval wait state.
     * @throws IssuanceError for invalid reasons, authority, state or an already open proposal;
     * database errors.
     */
    async propose(actor: number, input: Record<string, unknown>) {
      const action = input.action;
      if (typeof action !== 'string' || !Object.hasOwn(reasons, action)) {
        throw lifecycleRefusal(400, {
          action: [
            action === undefined
              ? 'This field is required.'
              : '"' + String(action) + '" is not a valid choice.',
          ],
        });
      }
      const selected = action as Action;
      const { reason, note } = statusReason(selected, input);
      const credentialId = lifecycleIdentifier(input.credential_id);
      return transaction(database, async (client: PoolClient) => {
        const {
          rows: [target],
        } = await client.query<{ issuer_id: string }>(
          'SELECT issuer_id FROM registered_certificates WHERE credential_id = $1 OR registered_id = $1',
          [credentialId],
        );
        if (!target) throw lifecycleRefusal(404, { detail: 'Unknown certificate' });
        await lockStatusManager(client, actor, target.issuer_id);
        // Read pending emergencies after acquiring the certificate lock. A
        // single locking query could retain its pre-wait MVCC snapshot.
        await client.query(
          'SELECT id FROM registered_certificates WHERE credential_id = $1 OR registered_id = $1 FOR UPDATE',
          [credentialId],
        );
        const {
          rows: [certificate],
        } = await client.query(
          `
          SELECT c.id, c.credential_id, ${standing} AS state, ${statusManagerAccess} AS can_manage,
            COALESCE(LEAST(ti.revoked_at, tao.revoked_at, root.revoked_at) <= statement_timestamp(), false) AS issuer_revoked,
            token.redeemed_at IS NOT NULL AS collected
          FROM registered_certificates c ${certificateOrganizations}
          LEFT JOIN credential_tokens token ON token.certificate_id = c.id
          WHERE (c.credential_id = $2 OR c.registered_id = $2)
        `,
          [actor, credentialId],
        );
        if (!certificate) throw lifecycleRefusal(404, { detail: 'Unknown certificate' });
        if (!certificate.can_manage)
          fail(403, 'NotYours', 'This operator cannot change the certificate.');
        if (!statusActions(certificate.state).includes(selected))
          throw lifecycleRefusal(409, {
            detail:
              "Action '" + selected + "' is not allowed from state '" + certificate.state + "'.",
          });
        if (selected === 'reinstate' && certificate.issuer_revoked)
          throw lifecycleRefusal(409, {
            detail:
              'The certification body that issued certificate ' +
              certificate.credential_id +
              ' was revoked; it cannot be reinstated.',
          });

        const salt = randomBytes(32);
        const storedReason = await storeReason(reason, note, salt, options.protection);
        const hash = storedReason.reason_hash;
        const {
          rows: [proposal],
        } = await client.query(
          `
          INSERT INTO certificate_status_proposals
            (certificate_id, action, initial_standing, reason_code, reason_note, reason_salt, reason_hash, proposed_by, requires_governance)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id
        `,
          [
            certificate.id,
            selected,
            certificate.state,
            reason,
            storedReason.reason_note,
            storedReason.reason_salt,
            hash,
            actor,
            // The certificate registry records a certificate only once it is collected, and
            // a proposal names a record: before collection a decision is local, and the
            // record carries its outcome when it is made.
            governanceEnabled && certificate.collected,
          ],
        );
        if (!proposal)
          throw lifecycleRefusal(409, {
            detail: 'Certificate ' + certificate.credential_id + ' already has an open proposal.',
          });
        await appendAudit(client, {
          event: 'status.change_proposed',
          actor,
          credentialId: certificate.credential_id,
          proposalId: proposal.id,
          detail: {
            action: selected,
            from_state: certificate.state,
            reason_code: reason,
            emergency: false,
            reason_hash: hash.toString('hex'),
          },
        });
        if (governanceEnabled)
          enqueueAfterCommit(client, {
            operation: 'submit-governance-proposal',
            proposalId: proposal.id,
          });
        return {
          proposal_id: proposal.id,
          action: selected,
          state: certificate.state,
          awaiting: 'second approver',
        };
      });
    },

    /**
     * Approve independently or reject a still-pending proposal.
     *
     * @param actor - Operator account ID.
     * @param proposalId - Untrusted local proposal ID.
     * @param decision - Approved or rejected decision.
     * @param signerApproval - Internal B-role approval path; ordinary HTTP decisions never set it.
     * @returns The decision result and any subsequent execution wait state.
     * @throws IssuanceError for missing authority, self-approval, closed cases, changed execution
     * mode or invalid state;
     * database errors.
     */
    async decide(
      actor: number,
      proposalId: unknown,
      decision: 'approved' | 'rejected',
      signerApproval = false,
    ) {
      if (
        typeof proposalId !== 'string' ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(proposalId)
      ) {
        throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
      }
      return transaction(database, async (client: PoolClient) => {
        const {
          rows: [target],
        } = await client.query<{ certificate_id: string; issuer_id: string }>(
          `
          SELECT c.id AS certificate_id, c.issuer_id FROM certificate_status_proposals p
          JOIN registered_certificates c ON c.id = p.certificate_id WHERE p.id = $1
        `,
          [proposalId],
        );
        if (!target) throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
        if (signerApproval && decision === 'approved') {
          await authorizeGovernance(client, actor, 'B', ['B']);
        } else await lockStatusManager(client, actor, target.issuer_id);
        await client.query('SELECT id FROM registered_certificates WHERE id = $1 FOR UPDATE', [
          target.certificate_id,
        ]);
        const {
          rows: [proposal],
        } = await client.query(
          `
          SELECT p.*, c.credential_id, (SELECT username FROM operator_accounts WHERE id=p.proposed_by) AS proposed_name, ${standing} AS state, ${statusManagerAccess} AS can_manage,
            EXISTS(SELECT 1 FROM credential_tokens t WHERE t.certificate_id=c.id AND t.redeemed_at IS NOT NULL) AS collected
          FROM certificate_status_proposals p
          JOIN registered_certificates c ON c.id = p.certificate_id ${certificateOrganizations}
          WHERE p.id = $2 FOR UPDATE OF p
        `,
          [actor, proposalId],
        );
        if (!proposal) throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
        if (!proposal.can_manage && !signerApproval)
          fail(403, 'NotYours', 'This operator cannot decide this proposal.');
        if (proposal.rejected_at || proposal.closed_at || proposal.applied_at)
          throw lifecycleRefusal(decision === 'approved' ? 403 : 409, {
            detail: 'This proposal is already closed.',
            ...(decision === 'approved' ? { reason: 'FourEyes' } : {}),
          });
        // A local decision becomes a governance case when the holder collected meanwhile:
        // its record exists now, and only the contract may change it.
        const governed = governanceEnabled && (proposal.requires_governance || proposal.collected);
        if (decision === 'approved') {
          if (proposal.requires_governance && !governanceEnabled)
            fail(
              409,
              'LifecycleModeChanged',
              'The request belongs to a different lifecycle execution mode.',
            );
          if (governed && !proposal.requires_governance)
            await client.query(
              'UPDATE certificate_status_proposals SET requires_governance=true WHERE id=$1',
              [proposalId],
            );
          if (proposal.proposed_by === actor)
            throw lifecycleRefusal(403, {
              reason: 'FourEyes',
              detail: 'The approver must be a different person from the proposer.',
            });
          if (!governed && !statusActions(proposal.state).includes(proposal.action)) {
            fail(
              409,
              'InvalidTransition',
              'The confirmed certificate state changed or is unavailable.',
            );
          }
        }
        if (decision === 'rejected') {
          await client.query(
            'UPDATE certificate_status_proposals SET rejected_at=clock_timestamp(),rejected_by=$2,closed_at=clock_timestamp(),delivery_attempted_at=NULL WHERE id=$1',
            [proposalId, actor],
          );
        }
        await client.query(
          `
          UPDATE certificate_status_proposals SET decision = CASE WHEN decision='approved' AND $2='rejected' THEN decision ELSE $2 END, decided_by = CASE WHEN decision='approved' AND $2='rejected' THEN decided_by ELSE $3 END,
            decided_at = CASE WHEN decision='approved' AND $2='rejected' THEN decided_at ELSE statement_timestamp() END,
            delivery_attempted_at = NULL,
            applied_at = CASE WHEN $4 THEN statement_timestamp() ELSE applied_at END
          WHERE id = $1
        `,
          [proposalId, decision, actor, decision === 'approved' && !governed],
        );
        const localApplication = decision === 'approved' && !governed;
        const nextStanding =
          proposal.action === 'suspend'
            ? 'suspended'
            : proposal.action === 'revoke'
              ? 'revoked'
              : 'active';
        if (localApplication)
          await client.query(
            `UPDATE registered_certificates SET local_standing = $2,
            ledger_standing = NULL, ledger_observed_at = NULL,
            ledger_observation_invalidated_at = clock_timestamp() WHERE id = $1`,
            [target.certificate_id, nextStanding],
          );
        await appendAudit(client, {
          event: decision === 'approved' ? 'status.change_approved' : 'status.change_rejected',
          actor,
          credentialId: proposal.credential_id,
          proposalId,
          detail: {
            action: proposal.action,
            reason_hash: '0x' + proposal.reason_hash.toString('hex'),
          },
        });
        if (localApplication)
          await appendAudit(client, {
            event: 'status.change_applied',
            credentialId: proposal.credential_id,
            proposalId,
            detail: { action: proposal.action, from_state: proposal.state, to_state: nextStanding },
          });
        if (localApplication && options.protection) {
          const applied = (
            await client.query('SELECT applied_at FROM certificate_status_proposals WHERE id=$1', [
              proposalId,
            ])
          ).rows[0];
          const approver = (
            await client.query('SELECT username FROM operator_accounts WHERE id=$1', [actor])
          ).rows[0];
          await anchorDecision(client, options.protection, {
            kind: 'status_change',
            certificate: proposal.certificate_id,
            credentialId: proposal.credential_id,
            proposal: proposalId,
            decision: {
              certificate: proposal.certificate_id,
              credential_id: proposal.credential_id,
              proposal: proposalId,
              action: proposal.action,
              from_state: proposal.state,
              to_state: nextStanding,
              proposed_by: proposal.proposed_name,
              approved_by: approver.username,
              reason_code: proposal.reason_code,
              reason_note: (await openReason(proposal, options.protection)).note,
              reason_hash: proposal.reason_hash.toString('hex'),
              onchain_proposal_id: null,
              decided_at: applied.applied_at,
            },
          });
        }
        if (governed)
          enqueueAfterCommit(client, {
            operation:
              decision === 'approved'
                ? 'submit-governance-signature'
                : 'withdraw-governance-proposal',
            proposalId: proposalId as string,
          });
        return decision === 'approved'
          ? {
              proposal_id: proposalId,
              applied: localApplication,
              awaiting: localApplication ? null : 'governance contract',
              state: localApplication ? nextStanding : proposal.state,
            }
          : { proposal_id: proposalId, rejected: true };
      });
    },
  };
}
