import { enqueueAfterCommit } from '../background/queue.ts';
import { lifecycleRefusal, lifecycleIdentifier } from './refusal.ts';
import { storeReason } from './reason-storage.ts';
import { anchorDecision } from '../audit/decisions.ts';
import type { Protection } from '../issuance/protection.ts';
import { randomBytes } from 'node:crypto';
import { appendAudit } from '../audit/journal.ts';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { reasonCommitment } from '../issuance/protection.ts';
import { certificateOrganizations, lockEmergencyAuthority, lifecycleStanding } from './access.ts';
import { statusReason } from './proposals.ts';
import { trimIdentityField } from '../identity/input-text.ts';

/**
 * Create transactional protective suspensions with local or ledger-backed application.
 *
 * @param database - PostgreSQL pool.
 * @param options - Whether collected emergencies require ledger delivery; defaults to enabled.
 * @returns An actor/input operation returning the emergency identifier and delivery state.
 */
export function postgresEmergencySuspension(
  database: Pool,
  options: { governanceEnabled?: boolean; protection?: Protection } = {},
) {
  const governanceEnabled = options.governanceEnabled ?? true;
  const standing = lifecycleStanding(governanceEnabled);
  /**
   * Record a protective suspension of an active certificate, including before collection.
   *
   * @param actor - Authorized manager or governing operator ID.
   * @param input - Credential ID and optional allowed suspension reason/note.
   * @returns The emergency ID and suspended state; awaiting is null for local/pre-collection
   * application, otherwise governance delivery remains pending.
   * @throws IssuanceError for invalid reason, missing authority, unknown certificate, wrong state
   * or duplicate pending emergency; database errors.
   */
  async function emergencySuspend(actor: number, input: Record<string, unknown>) {
    const { reason, note } = statusReason('suspend', { reason_code: 'key_compromise', ...input });
    const credentialId = lifecycleIdentifier(input.credential_id);
    return transaction(database, async (client: PoolClient) => {
      const {
        rows: [target],
      } = await client.query<{ issuer_id: string }>(
        'SELECT issuer_id FROM registered_certificates WHERE credential_id = $1 OR registered_id = $1',
        [credentialId],
      );
      if (!target) throw lifecycleRefusal(404, { detail: 'Unknown certificate' });
      await lockEmergencyAuthority(client, actor, target.issuer_id);
      // Read collection after acquiring the certificate lock; a waiting locking
      // SELECT could otherwise retain the token's pre-collection snapshot.
      await client.query(
        'SELECT id FROM registered_certificates WHERE credential_id = $1 OR registered_id = $1 FOR UPDATE',
        [credentialId],
      );
      const {
        rows: [certificate],
      } = await client.query(
        `
        SELECT c.id, c.credential_id, CASE WHEN c.registered_id IS NOT NULL AND c.ledger_registered_at IS NULL
          THEN c.local_standing ELSE ${standing} END AS state, token.redeemed_at IS NOT NULL AS collected,
          COALESCE(LEAST(ti.revoked_at, tao.revoked_at, root.revoked_at) <= statement_timestamp(), false) AS issuer_revoked
        FROM registered_certificates c ${certificateOrganizations}
        LEFT JOIN credential_tokens token ON token.certificate_id = c.id
        WHERE (c.credential_id = $1 OR c.registered_id = $1)
      `,
        [credentialId],
      );
      if (!certificate || certificate.state !== 'active') {
        throw lifecycleRefusal(409, {
          detail: "Action 'suspend' is not allowed from state '" + certificate?.state + "'.",
        });
      }
      const salt = randomBytes(32);
      const storedReason = await storeReason(reason, note, salt, options.protection);
      const {
        rows: [emergency],
      } = await client.query(
        `
        INSERT INTO certificate_emergency_suspensions
          (certificate_id, requested_by, reason_code, reason_note, reason_salt, reason_hash, applied_at)
        VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN clock_timestamp() END) ON CONFLICT DO NOTHING RETURNING id
      `,
        [
          certificate.id,
          actor,
          reason,
          storedReason.reason_note,
          storedReason.reason_salt,
          storedReason.reason_hash,
          !governanceEnabled || !certificate.collected,
        ],
      );
      if (!emergency)
        throw new IssuanceError(
          409,
          'EmergencyPending',
          'An emergency suspension is already pending.',
        );
      await client.query(
        "UPDATE registered_certificates SET local_standing = 'suspended' WHERE id = $1",
        [certificate.id],
      );
      await appendAudit(client, {
        event: 'status.emergency_suspension',
        actor,
        credentialId: certificate.credential_id,
        proposalId: emergency.id,
        detail: {
          emergency_id: emergency.id,
          action: 'suspend',
          from_state: 'active',
          to_state: 'suspended',
          reason_code: reason,
          emergency: true,
          reason_hash: '0x' + reasonCommitment(reason, note, salt).toString('hex'),
        },
      });
      if (options.protection) {
        const author = (
          await client.query('SELECT username FROM operator_accounts WHERE id=$1', [actor])
        ).rows[0];
        await anchorDecision(client, options.protection, {
          kind: 'emergency_suspension',
          certificate: certificate.id,
          credentialId: certificate.credential_id,
          proposal: emergency.id,
          decision: {
            certificate: certificate.id,
            credential_id: certificate.credential_id,
            proposal: emergency.id,
            action: 'suspend',
            decided_by: author.username,
            reason_code: reason,
            reason_note: note,
            decided_at: new Date(),
          },
        });
      }
      if (governanceEnabled && certificate.collected)
        enqueueAfterCommit(client, { operation: 'record-standing', certificateId: certificate.id });
      return {
        emergency_id: emergency.id,
        credential_id: certificate.credential_id,
        state: 'suspended',
        awaiting: governanceEnabled && certificate.collected ? 'governance contract' : null,
      };
    });
  }
  return emergencySuspend;
}

/**
 * Create the local verifier overlay for pending emergency suspensions.
 *
 * @param database - PostgreSQL pool.
 * @returns An issuer/credential lookup reporting whether a protective write remains pending.
 */
export function postgresPendingSuspension(database: Pool) {
  /**
   * Check pending protective suspension independently of ledger availability.
   *
   * @param issuerDid - Credential issuer DID.
   * @param credentialId - Public credential identifier.
   * @returns Whether a local emergency suspension is awaiting delivery.
   * @throws Database errors if a query, lock or commit fails.
   */
  async function isCertificateSuspended(issuerDid: string, credentialId: string) {
    const { rowCount } = await database.query(
      `
      SELECT 1 FROM certificate_emergency_suspensions emergency
      JOIN registered_certificates c ON c.id = emergency.certificate_id
      WHERE c.issuer_did = $1 AND (c.credential_id = $2 OR c.registered_id = $2) AND emergency.applied_at IS NULL
    `,
      [issuerDid, credentialId],
    );
    return Boolean(rowCount);
  }
  return isCertificateSuspended;
}
