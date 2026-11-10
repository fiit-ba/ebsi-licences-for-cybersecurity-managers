import { anchorDecision } from '../audit/decisions.ts';
import type { Pool, PoolClient } from 'pg';
import type { OrganizationRow } from '../accreditation/types.ts';
import type { RegistrationOptions } from './types.ts';
import type { Protection } from './protection.ts';
import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit/journal.ts';
import QRCode from 'qrcode';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError, normalizeClaims } from './claims.ts';
import { maxPinAttempts, preAuthorizedGrant, secretDigest } from './protection.ts';
import { defaultCredentialType } from './schemes.ts';
import { issuanceInput } from './input.ts';
import { trimIdentityField } from '../identity/input-text.ts';
import { schemaText, schemaFlag } from '../schemas/input.ts';

const genericTypes = ['VerifiableCredential', 'VerifiableAttestation'];

/**
 * Lock and validate a TI's current authority from root to leaf.
 *
 * @param client - Transaction connection.
 * @param accountId - Issuer operator account ID.
 * @param options - Whether ended accreditation is permitted for a replacement offer.
 * @returns The configured, locked TI organization.
 * @throws IssuanceError for missing issuer role, changed or revoked chain, expiry or incomplete
 * onboarding; database errors.
 */
async function lockedIssuer(
  client: PoolClient,
  accountId: number,
  options: { allowEnded?: boolean; allowUnconfigured?: boolean } = {},
) {
  const { allowEnded = false } = options;

  const {
    rows: [path],
  } = await client.query(
    `
    SELECT ti.id, tao.id AS tao_id, tao.parent_id AS root_id
    FROM accredited_organizations ti
    JOIN accredited_organizations tao ON tao.id = ti.parent_id
    WHERE ti.account_id = $1 AND ti.kind = 'ti'
  `,
    [accountId],
  );
  if (!path) throw new IssuanceError(403, 'NotATI', 'Only an accredited TI issues certificates.');

  // Match the parent-to-child lock order of accreditation changes.
  const ancestors = [];
  for (const id of [path.root_id, path.tao_id, path.id]) {
    const {
      rows: [organization],
    } = await client.query('SELECT * FROM accredited_organizations WHERE id = $1 FOR SHARE', [id]);
    ancestors.push(organization);
  }
  const [root, tao, ti] = ancestors;
  if (
    !root ||
    tao?.parent_id !== root.id ||
    ti?.parent_id !== tao?.id ||
    ti?.account_id !== accountId
  ) {
    throw new IssuanceError(403, 'NotATI', 'The TI account has changed.');
  }
  const { rowCount } = await client.query(
    `
    SELECT a.id FROM operator_accounts a JOIN operator_roles r ON r.account_id = a.id
    WHERE a.id = $1 AND a.active AND r.role = 'plr_issuer' FOR SHARE OF a, r
  `,
    [accountId],
  );
  if (!rowCount) throw new IssuanceError(403, 'RoleRequired', 'An issuer role is required.');
  const now = Date.now();
  if (ancestors.some((row) => row.revoked_at && row.revoked_at <= now)) {
    throw new IssuanceError(403, 'AccreditationRevoked', 'The accreditation was revoked.');
  }
  if (!allowEnded && ti.accredited_until && ti.accredited_until <= now) {
    throw new IssuanceError(403, 'AccreditationExpired', 'The accreditation has ended.', {
      accredited_until: ti.accredited_until,
    });
  }
  if (!options.allowUnconfigured && (!ti.did || !ti.tir_attribute_id)) {
    throw new IssuanceError(409, 'NotOnboarded', 'The TI is not configured as an issuer.');
  }
  return ti;
}

/**
 * Resolve the latest registered schema allowed by both TI and TAO grants.
 *
 * @param client - Transaction connection.
 * @param issuer - Locked issuer organization.
 * @param input - Requested credential_type or compatible credential_types field.
 * @returns The selected schema version and fields.
 * @throws IssuanceError when no granted published schema matches; database errors.
 */
async function chooseSchema(
  client: PoolClient,
  issuer: OrganizationRow,
  input: Record<string, unknown>,
) {
  const { rows } = await client.query(
    `
    SELECT s.id, s.credential_type, published.version, published.fields, published.tsr_id
    FROM certificate_schemas s
    JOIN organization_certificate_schemas g ON g.schema_id = s.id AND g.organization_id = $1
    JOIN organization_certificate_schemas p ON p.schema_id = s.id AND p.organization_id = $2
    JOIN LATERAL (
      SELECT version, fields, tsr_id FROM certificate_schema_versions
      WHERE schema_id = s.id AND registered_at IS NOT NULL ORDER BY version DESC LIMIT 1
    ) published ON true
    WHERE s.retired_at IS NULL
    ORDER BY s.credential_type COLLATE "C"
    FOR SHARE OF s
  `,
    [issuer.id, issuer.parent_id],
  );
  const legacyType = Array.isArray(input.credential_types)
    ? input.credential_types
        .map((type) => trimIdentityField(String(type)))
        .find((type) => !genericTypes.includes(type))
    : undefined;
  const requested =
    (schemaFlag(input.credential_type) ? schemaText(input.credential_type, 96 * 1024) : '') ||
    legacyType;
  const preferred = rows.find((row) => row.credential_type === defaultCredentialType) ?? rows[0];
  const schema = requested ? rows.find((row) => row.credential_type === requested) : preferred;
  if (!schema) {
    throw new IssuanceError(
      403,
      'SchemaNotAccredited',
      'This TI cannot issue the requested schema.',
      {
        credential_type: requested || defaultCredentialType,
      },
    );
  }
  return schema;
}

/**
 * Create certificate registration and expiring holder-offer operations.
 *
 * @param database - PostgreSQL pool.
 * @param options - Protection, public origin, accreditation check and optional schema-address
 * resolver.
 * @returns Registration, replacement-offer and public offer lookup operations.
 * @throws Error if publicOrigin is not an exact HTTP(S) origin.
 */
export function postgresCertificateRegistration(database: Pool, options: RegistrationOptions) {
  const { protection, publicOrigin, ensureAccredited, schemaAddress = undefined } = options;

  const issuerUrl = new URL(publicOrigin);
  if (
    !['http:', 'https:'].includes(issuerUrl.protocol) ||
    issuerUrl.origin + '/' !== issuerUrl.href
  ) {
    throw new Error('Issuance requires a public HTTP(S) origin.');
  }
  const origin = issuerUrl.origin;
  /**
   * Prepare a holder handoff response without storing its raw secrets.
   *
   * @param credentialId - Public credential identifier.
   * @param offer - Fresh offer code, PIN and expiry.
   * @param includeQr - Whether a QR data URL should be generated.
   * @returns Credential ID, wallet offer URI, PIN, expiry and optional QR.
   * @throws QR encoding errors if a requested image cannot be generated.
   */
  async function describeOffer(
    credentialId: string,
    offer: Awaited<ReturnType<Protection['newOffer']>>,
    includeQr: unknown,
  ) {
    const reference = origin + '/offers/' + offer.code;
    const offerUri =
      'openid-credential-offer://?credential_offer_uri=' + encodeURIComponent(reference);
    return {
      credential_id: credentialId,
      offer_uri: offerUri,
      pin: offer.pin,
      offer_expires_at: offer.expiresAt,
      ...(includeQr === true ? { qr: await QRCode.toDataURL(offerUri) } : {}),
    };
  }

  return {
    /**
     * Register encrypted certificate data and an initial offer atomically.
     *
     * @param accountId - Issuer account ID.
     * @param input - Holder reference, schema, claims, validity and optional QR flag.
     * @returns Certificate identifiers, issuer and one-time handoff details; the record key
     * exists only once the holder collects the credential.
     * @throws IssuanceInputError for serializer field/validity refusals; IssuanceError for invalid
     * claims, authority, accreditation or duplicate number; database and adapter errors.
     */
    async register(accountId: number, input: Record<string, unknown>) {
      const { holder, valid_from: validFrom, valid_until: validUntil } = issuanceInput(input);

      if (options.ensureIssuer) {
        // Validate the caller and selected fields before any external key creation.
        // Onboarding owns its own durable commits; never call it under these locks.
        const organization = await transaction(database, async (client) => {
          const issuer = await lockedIssuer(client, accountId, { allowUnconfigured: true });
          const schema = await chooseSchema(client, issuer, input);
          normalizeClaims(input.claims, schema.fields, issuer.name);
          return issuer;
        });
        if (!organization.did || !organization.tir_attribute_id) {
          try {
            await options.ensureIssuer(organization.id, accountId);
          } catch {
            throw new IssuanceError(409, 'NotOnboarded', 'The TI is not configured as an issuer.');
          }
        }
      }
      return transaction(database, async (client) => {
        const issuer = await lockedIssuer(client, accountId);
        const schema = await chooseSchema(client, issuer, input);
        const claims = normalizeClaims(input.claims, schema.fields, issuer.name);
        const suppliedNumber = claims.certificateNumber || claims.registrationNumber;
        const number =
          typeof suppliedNumber === 'string' || Number.isSafeInteger(suppliedNumber)
            ? trimIdentityField(String(suppliedNumber))
            : '';
        if (!number) {
          throw new IssuanceError(
            400,
            'CertificateNumberRequired',
            'The certificate needs its number.',
            {
              missing: ['certificateNumber'],
              invalid: [],
            },
          );
        }
        await ensureAccredited(issuer.did, schema.credential_type, {
          attribute: issuer.tir_attribute_id,
          schemaId: schemaAddress?.(schema.tsr_id),
        });

        const id = randomUUID();
        const credentialId = 'urn:uuid:' + id;
        const privateData = await protection.seal(id, { holder_reference: holder, claims });
        const offer = await protection.newOffer();
        const { rowCount } = await client.query(
          `
          INSERT INTO registered_certificates (
            id, credential_id, issuer_id, issuer_did, issuer_accredited_until, schema_id, schema_version,
            certificate_number, private_data, valid_from, valid_until, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT DO NOTHING
        `,
          [
            id,
            credentialId,
            issuer.id,
            issuer.did,
            issuer.accredited_until,
            schema.id,
            schema.version,
            number,
            privateData,
            validFrom,
            validUntil,
            accountId,
          ],
        );
        if (!rowCount) {
          throw new IssuanceError(
            409,
            'CertificateNumberTaken',
            'The TI already registered this certificate number.',
            {
              missing: [],
              invalid: ['certificateNumber'],
            },
          );
        }
        await client.query(
          `
          INSERT INTO credential_offers (certificate_id, code_digest, pin_digest, expires_at, pin_length)
          VALUES ($1, $2, $3, $4, $5)
        `,
          [id, offer.codeDigest, offer.pinDigest, offer.expiresAt, offer.pin?.length ?? null],
        );
        await appendAudit(client, {
          event: 'certificate.registered',
          actor: accountId,
          credentialId,
          organizationId: issuer.id,
          detail: {
            credential_type: schema.credential_type,
            version: schema.version,
          },
        });
        await appendAudit(client, {
          event: 'certificate.issued',
          actor: accountId,
          credentialId,
          organizationId: issuer.id,
          detail: { issuer_did: issuer.did, organization_id: issuer.id },
        });
        await appendAudit(client, {
          event: 'offer.created',
          actor: accountId,
          credentialId,
          detail: { expires_at: offer.expiresAt },
        });
        await anchorDecision(client, protection, {
          kind: 'issuance',
          certificate: id,
          credentialId,
          decision: {
            certificate: id,
            credential_id: credentialId,
            issuer_did: issuer.did,
            holder_reference: holder,
            claims,
            valid_from: validFrom,
            valid_until: validUntil,
            organization: issuer.id,
            organization_accredited_until: issuer.accredited_until,
            decided_at: new Date(),
          },
        });
        return {
          certificate_id: id,
          ...(await describeOffer(credentialId, offer, input.qr)),
          issuer_did: issuer.did,
          certificate_number: number,
        };
      });
    },

    /**
     * Replace an uncollected certificate's offer and invalidate the preceding grant.
     *
     * @param accountId - Issuer account ID.
     * @param input - Credential ID and optional QR flag.
     * @returns The replacement URI, PIN and expiry.
     * @throws IssuanceError for unknown, expired or collected certificates or
     * missing authority; database and QR errors.
     */
    async reoffer(accountId: number, input: Record<string, unknown>) {
      const credentialId = input.credential_id;
      if (typeof credentialId !== 'string' || !credentialId || credentialId.length > 255) {
        throw new IssuanceError(404, 'UnknownCertificate', 'Unknown certificate.');
      }

      return transaction(database, async (client) => {
        // Exchange locks the offer before creating a token. Redemption locks
        // the token before the issuer chain. Keep the same order here.
        const {
          rows: [certificate],
        } = await client.query(
          `
          SELECT c.id, c.issuer_id, c.issuer_did, c.valid_until
          FROM registered_certificates c JOIN credential_offers o ON o.certificate_id = c.id
          WHERE (c.credential_id = $1 OR c.registered_id = $1)
          FOR UPDATE OF o
        `,
          [credentialId],
        );
        if (!certificate)
          throw new IssuanceError(404, 'UnknownCertificate', 'Unknown certificate.');
        const {
          rows: [token],
        } = await client.query(
          `
          SELECT redeemed_at FROM credential_tokens WHERE certificate_id = $1 FOR UPDATE
        `,
          [certificate.id],
        );
        const issuer = await lockedIssuer(client, accountId, { allowEnded: true });
        if (issuer.id !== certificate.issuer_id || issuer.did !== certificate.issuer_did) {
          throw new IssuanceError(403, 'NotYours', 'Another TI issued this certificate.');
        }
        if (certificate.valid_until && certificate.valid_until <= Date.now()) {
          throw new IssuanceError(409, 'Expired', 'The certificate has expired.');
        }
        if (token?.redeemed_at) {
          throw new IssuanceError(
            409,
            'OfferAlreadyRedeemed',
            'This certificate has already been collected.',
          );
        }
        const offer = await protection.newOffer();
        // A replacement offer invalidates the previous uncollected grant.
        if (token) {
          await client.query('DELETE FROM credential_tokens WHERE certificate_id = $1', [
            certificate.id,
          ]);
        }
        await client.query(
          `
          UPDATE credential_offers
          SET code_digest = $2, pin_digest = $3, expires_at = $4, failed_attempts = 0, consumed_at = NULL, pin_length = $5
          WHERE certificate_id = $1
        `,
          [
            certificate.id,
            offer.codeDigest,
            offer.pinDigest,
            offer.expiresAt,
            offer.pin?.length ?? null,
          ],
        );
        await appendAudit(client, {
          event: 'offer.created',
          actor: accountId,
          credentialId,
          detail: { expires_at: offer.expiresAt, replacement: true },
        });
        return describeOffer(credentialId, offer, input.qr);
      });
    },

    /**
     * Resolve a currently usable pre-authorized offer as an OpenID4VCI 1.0 Credential Offer.
     *
     * @param code - Raw offer code from the wallet request.
     * @returns The offer, or undefined if unavailable.
     * @throws Database errors if a query, lock or commit fails.
     */
    async offer(code: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return;
      const {
        rows: [row],
      } = await database.query(
        `
        SELECT s.credential_type, octet_length(o.pin_digest)>0 AS pin_required, o.pin_length FROM credential_offers o
        JOIN registered_certificates c ON c.id = o.certificate_id
        JOIN certificate_schemas s ON s.id = c.schema_id
        JOIN accredited_organizations ti ON ti.id = c.issuer_id
        JOIN accredited_organizations tao ON tao.id = ti.parent_id
        JOIN accredited_organizations root ON root.id = tao.parent_id
        WHERE NOT EXISTS (
          SELECT 1 FROM (VALUES (ti.revoked_at), (tao.revoked_at), (root.revoked_at)) AS chain(revoked_at)
          WHERE revoked_at <= statement_timestamp()
        ) AND o.code_digest = $1 AND o.expires_at > statement_timestamp() AND o.consumed_at IS NULL AND o.failed_attempts < $2
      `,
        [secretDigest(code), maxPinAttempts],
      );
      if (!row) return;
      // OpenID4VCI 1.0: the credential configuration by its id in the issuer metadata, and a
      // tx_code object whenever the separately delivered PIN is required.
      return {
        credential_issuer: origin,
        credential_configuration_ids: [row.credential_type],
        grants: {
          [preAuthorizedGrant]: {
            'pre-authorized_code': code,
            ...(row.pin_required
              ? {
                  tx_code: {
                    input_mode: 'numeric',
                    ...(row.pin_length ? { length: row.pin_length } : {}),
                    description:
                      'PIN, ktorý ste dostali od vydávajúceho orgánu. / The PIN you received from the issuing body.',
                  },
                }
              : {}),
          },
        },
      };
    },
  };
}
