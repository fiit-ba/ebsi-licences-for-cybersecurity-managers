import { BoundCredentialRefusal } from './credential.ts';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Protection } from '../issuance/protection.ts';
import type { VerifyPresentation, VerifiedCredential } from './types.ts';

/** Presentation verification dependencies and retention settings. */
interface PresentationSessionOptions {
  verifyPresentation: VerifyPresentation;
  audience: string;
  protection: Protection;
  attributesSeconds?: number;
}

/** Public certificate evidence retained independently of encrypted disclosed attributes. */
interface PresentationEvidence {
  credential_id: string;
  issuer: string;
  credential_type: string;
  status_key: string | null;
  standing: string;
}

/** Stored presentation outcome projected for an authorized owner. */
interface PresentationResultRow {
  completed_at: Date | null;
  evidence: PresentationEvidence[];
  attributes_until: Date | null;
  outcome: string;
  failure_code: string;
  disclosed_data: Buffer | null;
  expired: boolean;
}

const opaque = () => randomBytes(32).toString('base64url');
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const sessionSeconds = 900;

/**
 * Create one-time presentation sessions with encrypted, expiring disclosures.
 *
 * @param database - PostgreSQL query executor.
 * @param options - Presentation verifier, audience, protection and positive attribute-retention
 * seconds.
 * @returns Session creation, challenge, submission, result and disclosure-purge operations.
 * @throws Error for invalid retention duration.
 */
export function postgresPresentationSessions(
  database: Pick<Pool, 'query'>,
  options: PresentationSessionOptions,
) {
  const { verifyPresentation, audience, protection, attributesSeconds = 900 } = options;

  if (!Number.isSafeInteger(attributesSeconds) || attributesSeconds <= 0) {
    throw new Error('Presentation attribute retention must be a positive number of seconds.');
  }
  /**
   * Read an uncompleted, unexpired presentation challenge.
   *
   * @param state - Opaque presentation state.
   * @returns Challenge bindings and expiry, or undefined when invalid/unavailable.
   * @throws Database errors if a query, lock or commit fails.
   */
  async function challenge(state: string) {
    if (typeof state !== 'string' || !statePattern.test(state)) return;
    const {
      rows: [request],
    } = await database.query<{
      audience: string;
      nonce: string;
      credential_types: string[];
      expires_at: Date;
    }>(
      `
      SELECT audience, nonce, credential_types, expires_at FROM presentation_sessions
      WHERE state = $1 AND completed_at IS NULL AND expires_at > statement_timestamp()
    `,
      [state],
    );
    if (request)
      return {
        state,
        audience: request.audience,
        nonce: request.nonce,
        credentialTypes: request.credential_types,
        expiresAt: request.expires_at,
      };
  }

  return {
    /**
     * Create a 15-minute challenge for an active verifier account.
     *
     * @param ownerId - Owner account ID.
     * @param credentialTypes - Nonempty supported credential-type names.
     * @returns State, nonce, audience and expiry, or undefined without verifier authority.
     * @throws Error for invalid credential types; database errors.
     */
    async create(ownerId: number, credentialTypes: string[]) {
      if (
        !Array.isArray(credentialTypes) ||
        !credentialTypes.length ||
        credentialTypes.some(
          (type) => typeof type !== 'string' || !/^[A-Z][A-Za-z0-9]{2,99}$/.test(type),
        )
      ) {
        throw new Error('A presentation must request supported credential types.');
      }
      const state = opaque();
      const nonce = opaque();
      const {
        rows: [request],
      } = await database.query(
        `
        INSERT INTO presentation_sessions (state, owner_id, audience, nonce, credential_types, expires_at)
        SELECT $1, a.id, $3, $4, $5, statement_timestamp() + $6 * interval '1 second'
        FROM operator_accounts a JOIN operator_roles r ON r.account_id = a.id
        WHERE a.id = $2 AND a.active AND r.role = 'plr_verifier'
        RETURNING expires_at
      `,
        [state, ownerId, audience, nonce, [...new Set(credentialTypes)], sessionSeconds],
      );
      if (!request) return;
      return { state, nonce, audience, expiresAt: request.expires_at };
    },

    challenge,

    /**
     * Verify and complete a challenge once, retaining only bounded private disclosures.
     *
     * @param state - Opaque presentation state.
     * @param token - Wallet presentation JWT.
     * @param options - Optional exact credential count.
     * @returns Whether this response completed the session.
     * @throws BoundCredentialRefusal after recording a terminal result; verifier, encryption and
     * database errors.
     * @remarks The final conditional update prevents competing or expired responses from completing
     * the same challenge.
     */
    async submit(state: string, token: string, options: { expectedCount?: number } = {}) {
      const { expectedCount } = options;

      const request = await challenge(state);
      if (!request) return false;
      let results: Omit<VerifiedCredential, 'subject'>[] = [];
      let refusal;
      try {
        results = await verifyPresentation(token, { ...request, expectedCount });
      } catch (error) {
        if (!(error instanceof BoundCredentialRefusal)) throw error;
        refusal = error;
      }
      if (!refusal && expectedCount !== undefined && results.length !== expectedCount) return false;
      const evidence = results.map(({ credentialId, issuer, type, statusKey }) => ({
        credential_id: credentialId,
        issuer,
        credential_type: type,
        status_key: statusKey,
        standing: 'valid',
      }));
      const attributes = results.map((result) => result.claims);
      const encrypted = refusal ? null : await protection.seal('presentation:' + state, attributes);
      // Verification can involve network calls. Complete only if this
      // request still exists and no other response won the race.
      const { rowCount } = await database.query(
        `
        UPDATE presentation_sessions
        SET completed_at = statement_timestamp(), evidence = $2, disclosed_data = $3,
          attributes_until = CASE WHEN $3::bytea IS NOT NULL THEN statement_timestamp() + $4 * interval '1 second' END,
          outcome = $5, failure_code = $6
        WHERE state = $1 AND completed_at IS NULL AND expires_at > statement_timestamp()
      `,
        [
          state,
          JSON.stringify(evidence),
          encrypted,
          attributesSeconds,
          refusal?.outcome ?? 'VALID',
          refusal?.code ?? null,
        ],
      );
      if (rowCount === 1 && refusal) throw refusal;
      return rowCount === 1;
    },

    /**
     * Read the owner's verification result and only still-retained attributes.
     *
     * @param ownerId - Verifier owner account ID.
     * @param state - Opaque presentation state.
     * @returns Pending, expired or completed result; undefined for inaccessible sessions.
     * @throws Database or decryption errors.
     */
    async result(ownerId: number, state: string | null) {
      if (typeof state !== 'string' || !statePattern.test(state)) return;
      const {
        rows: [result],
      } = await database.query<PresentationResultRow>(
        `
        SELECT completed_at, evidence, attributes_until, outcome, failure_code,
          CASE WHEN attributes_until > statement_timestamp() THEN disclosed_data END AS disclosed_data,
          expires_at <= statement_timestamp() AS expired
        FROM presentation_sessions s
        JOIN operator_accounts a ON a.id = s.owner_id AND a.active
        JOIN operator_roles r ON r.account_id = a.id AND r.role = 'plr_verifier'
        WHERE s.state = $1 AND s.owner_id = $2
      `,
        [state, ownerId],
      );
      if (!result) return;
      if (!result.completed_at)
        return { status: result.expired ? ('expired' as const) : ('pending' as const) };

      const attributes = result.disclosed_data
        ? await protection.open('presentation:' + state, result.disclosed_data)
        : [];
      return {
        status: 'done' as const,
        verified: result.outcome === 'VALID',
        outcome: result.outcome,
        ...(result.failure_code ? { detail: result.failure_code } : {}),
        credential_types: [...new Set(result.evidence.map((item) => item.credential_type))],
        checks: {
          presentation_valid: true,
          signature_valid: true,
          holder_bound: true,
          ...(result.outcome === 'UNTRUSTED_ISSUER' ? { issuer_accredited: false } : {}),
          ...(['Suspended', 'Revoked'].includes(result.failure_code)
            ? { standing_valid: false }
            : {}),
          ...(result.failure_code === 'AccreditationRevoked' ? { issuer_accredited: false } : {}),
          ...(result.failure_code === 'SchemaMismatch' ? { schemas_valid: false } : {}),
          ...(['EXPIRED', 'NOT_YET_VALID'].includes(result.outcome) ? { time_valid: false } : {}),
        },
        credentials: result.evidence.map((item, index) => ({
          ...item,
          attributes: attributes[index] ?? {},
        })),
        attributes_until: result.disclosed_data ? result.attributes_until : null,
        created_at: result.completed_at,
      };
    },

    /**
     * Erase encrypted disclosures whose retention deadline has elapsed.
     *
     * @returns The number of rows purged.
     * @throws Database errors if a query, lock or commit fails.
     */
    async purgeAttributes() {
      const { rowCount } = await database.query(`
        UPDATE presentation_sessions SET disclosed_data = NULL, attributes_until = NULL
        WHERE attributes_until <= statement_timestamp() AND disclosed_data IS NOT NULL
      `);
      return rowCount;
    },
  };
}
