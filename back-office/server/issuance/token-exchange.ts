import type { Pool } from 'pg';
import type { Protection } from './protection.ts';
import type { IssuanceProtocolResult, AuthorizationSigning } from './types.ts';
import { calculateJwkThumbprint } from 'jose';
import { appendAudit } from '../audit/journal.ts';
import { transaction } from '../adapters/transaction.ts';
import { maxPinAttempts, preAuthorizedGrant, secretDigest } from './protection.ts';

// The issuance protocol profile uses one hour for both values.
const lifetimeSeconds = 3600;
const failure = (error: string, error_description: string) => ({
  status: 400,
  body: { error, error_description },
});

/**
 * Create the one-time code and transaction-code (PIN) token-exchange service (OpenID4VCI 1.0).
 *
 * @param database - PostgreSQL pool.
 * @param protection - PIN validation and digest protection operations.
 * @param authorization - Registry issuer URI and its KMS-backed token signing identity.
 * @returns An atomic token-exchange operation.
 */
export function postgresCredentialTokenExchange(
  database: Pool,
  protection: Protection,
  authorization: { issuer: string; signing: AuthorizationSigning },
) {
  return {
    /**
     * Consume a valid offer and issue a short-lived bearer; the proof's c_nonce comes from the
     * Nonce Endpoint.
     *
     * @param input - Untrusted pre-authorized grant, code and transaction code (tx_code).
     * @returns An HTTP status/body result containing tokens or an OAuth refusal.
     * @throws Database or crypto errors if exchange cannot complete.
     * @remarks Invalid PIN attempts are counted; the fifth failure locks the offer. Raw bearer
     * tokens are not stored.
     */
    async exchange(input: Record<string, unknown>): Promise<IssuanceProtocolResult> {
      if (input.grant_type !== preAuthorizedGrant) {
        return failure('unsupported_grant_type', 'Expected a pre-authorized code grant.');
      }
      const code = input['pre-authorized_code'];
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
        return failure('invalid_grant', 'The offer is unavailable.');
      }
      // OpenID4VCI 1.0 names the separately delivered PIN tx_code.
      const pin = input.tx_code;
      const digest = secretDigest(code);

      return transaction(database, async (client) => {
        const {
          rows: [offer],
        } = await client.query(
          `
          SELECT certificate_id, pin_digest, failed_attempts
          FROM credential_offers WHERE code_digest = $1 AND consumed_at IS NULL
          FOR UPDATE
        `,
          [digest],
        );
        if (!offer || offer.failed_attempts >= maxPinAttempts) {
          return failure('invalid_grant', 'The offer is unavailable.');
        }

        // Check eligibility after locking the offer. A transaction waiting for
        // the offer sees committed revocations and expiry at this statement.
        const { rowCount } = await client.query(
          `
          SELECT 1 FROM credential_offers o
          JOIN registered_certificates c ON c.id = o.certificate_id
          JOIN accredited_organizations ti ON ti.id = c.issuer_id
          JOIN accredited_organizations tao ON tao.id = ti.parent_id
          JOIN accredited_organizations root ON root.id = tao.parent_id
          WHERE o.certificate_id = $1 AND o.expires_at > statement_timestamp()
            AND (c.valid_until IS NULL OR c.valid_until > statement_timestamp())
            AND NOT EXISTS (
              SELECT 1 FROM (VALUES (ti.revoked_at), (tao.revoked_at), (root.revoked_at)) AS chain(revoked_at)
              WHERE revoked_at <= statement_timestamp()
            )
        `,
          [offer.certificate_id],
        );
        if (!rowCount) return failure('invalid_grant', 'The offer is unavailable.');
        const {
          rows: [reference],
        } = await client.query('SELECT credential_id FROM registered_certificates WHERE id = $1', [
          offer.certificate_id,
        ]);
        if (offer.pin_digest.length && (pin == null || pin === ''))
          return failure('invalid_request', 'A transaction code (tx_code) is required.');

        if (
          offer.pin_digest.length &&
          (typeof pin !== 'string' || !(await protection.matchesPin(code, pin, offer.pin_digest)))
        ) {
          // Return the error after commit so a wrong PIN spends an attempt.
          await client.query(
            `
            UPDATE credential_offers SET failed_attempts = failed_attempts + 1 WHERE certificate_id = $1
          `,
            [offer.certificate_id],
          );
          await appendAudit(client, {
            event: 'offer.refused',
            credentialId: reference.credential_id,
            detail: { reason: 'InvalidPin', attempt: offer.failed_attempts + 1 },
          });
          return failure('invalid_grant', 'The offer or PIN is invalid.');
        }

        const key = await authorization.signing.key(client);
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const header = encode({
          alg: 'ES256',
          typ: 'JWT',
          kid: await calculateJwkThumbprint(key.publicJwk),
        });
        // The authorization JWT uses milliseconds for exp. Local
        // expiry is still enforced independently by the stored one-hour grant.
        const payload = encode({
          aud: authorization.issuer,
          iss: authorization.issuer,
          sub: code,
          exp: Date.now() + lifetimeSeconds * 1000,
        });
        const inputBytes = Buffer.from(header + '.' + payload);
        const token =
          inputBytes.toString() +
          '.' +
          Buffer.from(await key.sign(inputBytes)).toString('base64url');
        const { rowCount: created } = await client.query(
          `
          INSERT INTO credential_tokens (token_digest, certificate_id, expires_at)
          VALUES ($1, $2, statement_timestamp() + $3 * interval '1 second')
          ON CONFLICT (certificate_id) DO NOTHING
        `,
          [secretDigest(token), offer.certificate_id, lifetimeSeconds],
        );
        if (!created) return failure('invalid_grant', 'The offer is unavailable.');
        await client.query(
          `
          UPDATE credential_offers SET consumed_at = statement_timestamp() WHERE certificate_id = $1
        `,
          [offer.certificate_id],
        );
        await appendAudit(client, {
          event: 'offer.token_issued',
          credentialId: reference.credential_id,
        });
        return {
          status: 200,
          body: {
            access_token: token,
            token_type: 'Bearer',
            expires_in: lifetimeSeconds,
          },
        };
      });
    },
  };
}
