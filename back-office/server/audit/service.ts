import { openReason } from '../lifecycle/reason-storage.ts';
import { lifecycleRefusal } from '../lifecycle/refusal.ts';
import { auditReasonInput } from './input.ts';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError } from '../issuance/claims.ts';
import type { Protection } from '../issuance/protection.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import { appendAudit, inspectAudit } from './journal.ts';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Check the current auditor role and inherited organization revocation.
 *
 * @param client - Transaction connection.
 * @param actor - Operator account ID.
 * @param lock - Whether to retain shared locks on the account and role.
 * @returns Completion when the actor is an active auditor.
 * @throws IssuanceError if an active auditor role is unavailable; database errors.
 */
export async function authorizeAuditor(client: PoolClient, actor: number, lock = false) {
  const { rowCount } = await client.query(
    `
    SELECT a.id FROM operator_accounts a JOIN operator_roles r ON r.account_id = a.id
    WHERE a.id = $1 AND a.active AND r.role = 'plr_auditor' AND NOT EXISTS (
      SELECT 1 FROM accredited_organizations o
      LEFT JOIN accredited_organizations p ON p.id = o.parent_id
      LEFT JOIN accredited_organizations root ON root.id = p.parent_id
      WHERE o.account_id = a.id AND LEAST(o.revoked_at, p.revoked_at, root.revoked_at) <= statement_timestamp()
    ) ${lock ? 'FOR SHARE OF a, r' : ''}
  `,
    [actor],
  );
  if (!rowCount)
    throw new IssuanceError(403, 'RoleRequired', 'An active auditor role is required.');
}

/**
 * Create auditor-only journal reads and recorded commitment disclosures.
 *
 * @param database - PostgreSQL pool.
 * @param protection - Optional protection for deriving certificate salts.
 * @returns List, certificate-preimage and reason-preimage operations.
 */
export function postgresAudit(database: Pool, protection?: Protection) {
  return {
    /**
     * Read a cursor page and verify the whole journal under one snapshot.
     *
     * @param actor - Auditor account ID.
     * @param query - Limit, optional credential filter and before_id cursor.
     * @returns Journal entries, next cursor and full-chain integrity report.
     * @throws IssuanceError for invalid cursor or missing auditor authority; database errors.
     */
    async list(actor: number, query: URLSearchParams) {
      const raw = query.get('limit');
      const limit =
        raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))
          ? Math.min(500, Math.max(1, Number(raw)))
          : 100;
      const before = query.get('before_id');
      if (
        before !== null &&
        (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n)
      ) {
        throw new IssuanceError(
          400,
          'InvalidCursor',
          'Use a positive audit sequence as the cursor.',
        );
      }
      const credential = query.get('credential_id');
      return transaction(database, async (client: PoolClient) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await authorizeAuditor(client, actor);
        const chain = await inspectAudit(client);
        const { rows } = await client.query(
          `
          SELECT id::text, event, occurred_at, actor_username AS actor, credential_id, proposal_id,
            organization_id, detail, payload, encode(previous_hash, 'hex') AS previous_hash,
            encode(entry_hash, 'hex') AS entry_hash
          FROM audit_entries WHERE ($1::text IS NULL OR credential_id = $1 OR credential_id IN (
            SELECT unnest(ARRAY[c.credential_id,c.registered_id]) FROM registered_certificates c
            WHERE c.credential_id=$1 OR c.registered_id=$1))
            AND ($2::bigint IS NULL OR id < $2) ORDER BY audit_entries.id DESC LIMIT $3
        `,
          [credential, before, limit + 1],
        );
        const results = rows.slice(0, limit);
        return {
          chain_intact: chain.intact,
          chain,
          results,
          next: rows.length > limit ? results.at(-1).id : null,
        };
      });
    },

    /**
     * Disclose what a certificate's record key is computed from, only after recording the
     * disclosure: an auditor checks `computeStatusKey(issuer_did, certificate_id)` against a
     * proposal's `statusKey` without the certification body's systems.
     *
     * @param actor - Auditor account ID.
     * @param input - Public credential ID.
     * @returns Issuer DID, collected credential id, certificate number and record key (null
     * before collection).
     * @throws IssuanceError for missing authority/protection or unknown certificate; database
     * errors.
     */
    async commitmentPreimage(actor: number, input: Record<string, unknown>) {
      const id = input.credential_id;
      if (typeof id !== 'string' || !id || id.length > 255) {
        throw lifecycleRefusal(404, { detail: 'Unknown certificate' });
      }
      return transaction(database, async (client: PoolClient) => {
        await authorizeAuditor(client, actor, true);
        if (!protection)
          throw new IssuanceError(
            503,
            'IssuanceDisabled',
            'Issuance protection is not configured.',
          );
        const {
          rows: [certificate],
        } = await client.query(
          `
          SELECT id, credential_id, issuer_did, certificate_number, status_key FROM registered_certificates WHERE credential_id = $1 OR registered_id = $1 FOR SHARE
        `,
          [id],
        );
        if (!certificate) throw lifecycleRefusal(404, { detail: 'Unknown certificate' });
        await appendAudit(client, {
          event: 'audit.preimage_disclosed',
          actor,
          credentialId: certificate.credential_id,
        });
        return {
          issuer_did: certificate.issuer_did,
          certificate_id: certificate.status_key ? certificate.credential_id : null,
          certificate_number: certificate.certificate_number,
          status_key: certificate.status_key ? '0x' + certificate.status_key.toString('hex') : null,
        };
      });
    },

    /**
     * Disclose an exact decision, withdrawal or emergency reason and salt.
     *
     * @param actor - Auditor account ID.
     * @param input - Reason kind and local or unambiguous on-chain proposal identifier.
     * @returns Recorded reason fields, salt, commitment and deployment identity.
     * @throws IssuanceError for invalid identifiers, ambiguity, missing authority/reason or
     * commitment mismatch; database errors.
     */
    async reasonPreimage(actor: number, input: Record<string, unknown>) {
      let kind = input.kind ?? 'decision';
      if (!['decision', 'withdrawal', 'emergency'].includes(String(kind))) {
        throw new IssuanceError(400, 'InvalidFields', 'Unknown reason kind.');
      }
      let emergency = kind === 'emergency';
      const source = kind === 'decision' ? auditReasonInput(input) : undefined;
      const localId = emergency ? input.emergency_id : source ? source.local : input.proposal_id;
      const rawId =
        !emergency && localId === undefined
          ? (source?.onchain ?? input.onchain_proposal_id)
          : undefined;
      const onchainId =
        typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : rawId;
      if (
        (localId !== undefined && (typeof localId !== 'string' || !uuid.test(localId))) ||
        (localId === undefined &&
          (typeof onchainId !== 'string' || !/^[1-9]\d{0,77}$/.test(onchainId)))
      ) {
        throw new IssuanceError(404, 'UnknownProposal', 'Unknown proposal.');
      }
      return transaction(database, async (client: PoolClient) => {
        await authorizeAuditor(client, actor, true);
        const { rows } = await client.query(
          `
          SELECT p.*, c.credential_id FROM ${emergency ? 'certificate_emergency_suspensions' : 'certificate_status_proposals'} p
          JOIN registered_certificates c ON c.id = p.certificate_id
          WHERE ${localId === undefined ? 'p.onchain_proposal_id = $1::numeric' : 'p.id = $1::uuid'}
          LIMIT 2
        `,
          [localId ?? onchainId],
        );
        if (!rows.length && kind === 'decision' && localId) {
          const fallback = await client.query(
            'SELECT p.*,c.credential_id FROM certificate_emergency_suspensions p JOIN registered_certificates c ON c.id=p.certificate_id WHERE p.id=$1',
            [localId],
          );
          if (fallback.rows.length) {
            rows.push(...fallback.rows);
            emergency = true;
            kind = 'emergency';
          }
        }
        if (!rows.length) throw lifecycleRefusal(404, { detail: 'Unknown proposal' });
        if (rows.length > 1)
          throw new IssuanceError(
            409,
            'AmbiguousProposal',
            'Use the local proposal ID to identify its deployment.',
          );
        const row = rows[0];
        const withdrawal = kind === 'withdrawal';
        const reason = withdrawal ? 'withdrawn' : row.reason_code;
        let note = withdrawal ? row.withdrawal_note : row.reason_note;
        let salt = withdrawal ? row.withdrawal_salt : row.reason_salt;
        const hash = withdrawal ? row.withdrawal_hash : row.reason_hash;
        if (!salt || !hash)
          throw new IssuanceError(404, 'UnknownReason', 'No reason of this kind is recorded.');
        try {
          const opened = await openReason(
            { reason_code: reason, reason_note: note, reason_salt: salt, reason_hash: hash },
            protection,
          );
          note = opened.note;
          salt = opened.salt;
        } catch (error) {
          if (error instanceof IssuanceError && error.status === 503) throw error;
          throw new IssuanceError(
            409,
            'ReasonMismatch',
            'The recorded reason does not match its commitment.',
          );
        }
        await appendAudit(client, {
          event: 'audit.reason_disclosed',
          actor,
          credentialId: row.credential_id,
          proposalId: row.id,
          detail: {
            kind,
            action: emergency ? 'suspend' : row.action,
            onchain_proposal_id: row.onchain_proposal_id ?? '',
            reason_hash: '0x' + hash.toString('hex'),
            ...(emergency ? { emergency_id: row.id } : {}),
          },
        });
        return {
          kind,
          proposal_id: row.id,
          ...(emergency ? { emergency_id: row.id } : {}),
          onchain_proposal_id: row.onchain_proposal_id ?? null,
          governance_contract: row.onchain_contract?.toLowerCase() ?? null,
          chain_id: row.onchain_chain_id ?? null,
          action: emergency ? 'suspend' : row.action,
          reason_code: reason,
          reason_note: note,
          salt: '0x' + salt.toString('hex'),
          reason_hash: hash.toString('hex'),
        };
      });
    },
  };
}
