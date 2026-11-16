import { enqueueAfterCommit } from '../background/queue.ts';
import type { Pool, PoolClient } from 'pg';
import type { IssuanceProtocolResult, FinalizationInput } from './types.ts';
import type { Protection } from './protection.ts';
import type { CredentialNonces } from './nonces.ts';

/** Protection, nonces and finalization used by holder-bound credential redemption. */
interface RedemptionOptions {
  audience: string;
  protection: Protection;
  nonces: CredentialNonces;
  finalize(input: FinalizationInput): Promise<string>;
}
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { verifiedKeyProof } from './holder-proof.ts';
import { certificateStatusKey, credentialHash, secretDigest } from './protection.ts';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';

const invalidToken = { status: 401, body: { error: 'invalid_token' } };

/**
 * Load a redeemable certificate with a nonrevoked issuer chain.
 *
 * @param client - Transaction connection.
 * @param id - Internal certificate UUID.
 * @returns The issuance record, or undefined when no longer eligible.
 * @throws Database errors if a query, lock or commit fails.
 */
async function eligibleCertificate(client: PoolClient, id: string) {
  const {
    rows: [certificate],
  } = await client.query(
    `
    SELECT c.*, s.credential_type, v.tsr_id, ti.tir_attribute_id, tao.id AS tao_id, root.id AS root_id
    FROM registered_certificates c
    JOIN certificate_schemas s ON s.id = c.schema_id
    JOIN LATERAL (
      SELECT tsr_id FROM certificate_schema_versions
      WHERE schema_id = c.schema_id AND registered_at IS NOT NULL
      ORDER BY version DESC LIMIT 1
    ) v ON true
    JOIN accredited_organizations ti ON ti.id = c.issuer_id
    JOIN accredited_organizations tao ON tao.id = ti.parent_id
    JOIN accredited_organizations root ON root.id = tao.parent_id
    WHERE c.id = $1 AND ti.did = c.issuer_did AND ti.tir_attribute_id IS NOT NULL
      AND (c.valid_until IS NULL OR c.valid_until > statement_timestamp())
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES (ti.revoked_at), (tao.revoked_at), (root.revoked_at)) AS chain(revoked_at)
      WHERE revoked_at <= statement_timestamp()
    )
  `,
    [id],
  );
  return certificate;
}

/**
 * Create holder-bound credential redemption.
 *
 * @param database - PostgreSQL pool.
 * @param options - Proof audience, encryption protection and credential finalizer.
 * @returns The credential redemption operation.
 */
export function postgresCredentialRedemption(database: Pool, options: RedemptionOptions) {
  const { audience, protection, nonces, finalize } = options;
  const refusal = (error: string, description: string) => ({
    status: 400,
    body: { error, error_description: description },
  });

  return {
    /**
     * Bind a bearer to a verified holder before finalizing and consuming it (OpenID4VCI 1.0).
     *
     * @param token - Raw issuance bearer.
     * @param input - Requested credential configuration and one `jwt` key proof.
     * @returns An HTTP result containing the credential or a protocol refusal.
     * @throws Database, decryption, trust or signing errors; Error if the finalizer returns
     * no credential.
     * @remarks Proof, signing and consumption share the token/certificate transaction. Failure
     * preserves the uncollected state; a replacement offer invalidates its old grant.
     * Ledger registration runs after collection through the background worker.
     */
    async redeem(
      token: unknown,
      input: {
        credential_configuration_id?: unknown;
        credential_identifier?: unknown;
        proofs?: unknown;
        proof?: unknown;
      },
    ): Promise<IssuanceProtocolResult> {
      if (
        typeof token !== 'string' ||
        token.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      )
        return invalidToken;
      const digest = secretDigest(token);
      return transaction(database, async (client) => {
        const {
          rows: [grant],
        } = await client.query(
          `
          SELECT certificate_id FROM credential_tokens
          WHERE token_digest = $1 AND redeemed_at IS NULL AND expires_at > statement_timestamp()
          FOR UPDATE
        `,
          [digest],
        );
        if (!grant) return invalidToken;

        const path = await eligibleCertificate(client, grant.certificate_id);
        if (!path) return invalidToken;

        // The token answered a pre-authorized offer of one configuration, without
        // authorization_details, so the request names that configuration and no identifier.
        if (input?.credential_identifier !== undefined)
          return refusal('unknown_credential_identifier', 'No credential identifiers are issued.');
        if (input?.credential_configuration_id !== path.credential_type)
          return refusal(
            'unknown_credential_configuration',
            'The offer is for ' + path.credential_type + '.',
          );
        const proofs = input?.proofs as { jwt?: unknown } | undefined;
        if (
          input?.proof !== undefined ||
          !proofs ||
          typeof proofs !== 'object' ||
          Object.keys(proofs).length !== 1 ||
          !Array.isArray(proofs.jwt) ||
          proofs.jwt.length !== 1
        )
          return refusal('invalid_credential_request', 'Send exactly one jwt key proof in proofs.');
        const proof = await verifiedKeyProof(proofs.jwt[0], audience);
        if (!proof) return refusal('invalid_proof', 'The key proof is invalid.');
        // A c_nonce from the Nonce Endpoint, spent here once.
        if (!(await nonces.consume(client, proof.nonce)))
          return refusal('invalid_nonce', 'Request a fresh c_nonce from the Nonce Endpoint.');
        const subject = proof.did;

        // Collection refuses an explicit start date before the issuance instant.
        if (path.valid_from && +path.valid_from < Date.now())
          throw new Error('"validFrom" can not be before "issuanceDate"');
        // The same root-to-leaf order is used by accreditation changes.
        for (const id of [path.root_id, path.tao_id, path.issuer_id]) {
          await client.query('SELECT id FROM accredited_organizations WHERE id = $1 FOR SHARE', [
            id,
          ]);
        }
        // Serialize issuance with pre-collection decisions and emergency suspension.
        await client.query('SELECT id FROM registered_certificates WHERE id = $1 FOR UPDATE', [
          grant.certificate_id,
        ]);
        const certificate = await eligibleCertificate(client, grant.certificate_id);
        if (
          !certificate ||
          certificate.root_id !== path.root_id ||
          certificate.tao_id !== path.tao_id
        ) {
          return invalidToken;
        }
        const { rowCount: uncertain } = await client.query(
          `SELECT 1 FROM certificate_status_proposals WHERE certificate_id = $1
            AND requires_governance AND delivery_uncertain AND applied_at IS NULL AND closed_at IS NULL`,
          [certificate.id],
        );
        if (uncertain)
          return {
            status: 503,
            body: {
              error: 'temporarily_unavailable',
              error_description: 'A status decision is awaiting reconciliation.',
            },
          };
        const { claims } = await protection.open(certificate.id, certificate.private_data);
        const issued = {
          ...certificate,
          credential_id: 'urn:uuid:' + randomUUID(),
        };
        const credential = await finalize({
          certificate: issued,
          claims,
          subject,
          client,
        });
        if (typeof credential !== 'string' || !credential)
          throw new Error('Issuer returned no credential.');
        const document = decodeJwt(credential.split('~')[0]).vc as {
          id: string;
          validFrom?: string;
          issuanceDate: string;
          expirationDate: string;
        };
        if (document.id !== issued.credential_id)
          throw new Error('The signed credential identifier does not match its issuance.');
        // The record the certificate registry keeps it under: the TI and this credential's id.
        const statusKey = certificateStatusKey(certificate.issuer_did, issued.credential_id);
        const validFrom =
          certificate.valid_from ?? new Date(document.validFrom ?? document.issuanceDate);
        const validUntil = certificate.valid_until ?? new Date(document.expirationDate);
        if (!Number.isFinite(+validFrom) || !Number.isFinite(+validUntil))
          throw new Error('The signed credential has invalid validity dates.');

        await client.query(
          `
          UPDATE credential_tokens SET redeemed_at = statement_timestamp()
          WHERE token_digest = $1
        `,
          [digest],
        );
        await client.query(
          `
          UPDATE registered_certificates SET registered_id=COALESCE(registered_id,credential_id),
            credential_id=$2,valid_from=$3,valid_until=$4,status_key=$5,credential_hash=$6,
            ledger_standing=NULL,ledger_observed_at=NULL
          WHERE id = $1
        `,
          [
            certificate.id,
            issued.credential_id,
            validFrom,
            validUntil,
            statusKey,
            credentialHash(credential),
          ],
        );
        await appendAudit(client, {
          event: 'certificate.collected',
          credentialId: issued.credential_id,
          organizationId: certificate.issuer_id,
          detail: {
            issuer_did: certificate.issuer_did,
            credential_type: certificate.credential_type,
            status_key: '0x' + statusKey.toString('hex'),
          },
        });
        enqueueAfterCommit(client, { operation: 'record-standing', certificateId: certificate.id });
        return { status: 200, body: { credentials: [{ credential }] } };
      });
    },
  };
}
