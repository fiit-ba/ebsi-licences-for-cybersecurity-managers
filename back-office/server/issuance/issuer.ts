import { certificateFinalizer } from './finalizer.ts';
import { preAuthorizedGrant } from './protection.ts';
import { postgresCredentialRedemption } from './redemption.ts';
import { postgresCertificateRegistration } from './registration.ts';
import { postgresCredentialTokenExchange } from './token-exchange.ts';
import { postgresIssuanceLedgerDelivery } from './ledger-delivery.ts';
import { postgresCredentialNonces } from './nonces.ts';

/**
 * Assemble issuance storage, redemption and discovery metadata.
 *
 * @param database - PostgreSQL pool.
 * @param options - Public origin, protection, trust, signing, schema and ledger adapters.
 * @returns Registration, token exchange, redemption and public protocol metadata.
 * @throws Error for invalid origin or invalid downstream adapter configuration.
 */
export function createIssuer(database: Pool, options: IssuerOptions) {
  const origin = new URL(options.publicOrigin).origin;
  const registration = postgresCertificateRegistration(database, options);
  const finalize = certificateFinalizer(options);
  const nonces = postgresCredentialNonces(database);
  return {
    nonces,
    registration,
    deliverRegistrations: postgresIssuanceLedgerDelivery(
      database,
      options.ledger,
      options.protection,
    ),
    tokens: postgresCredentialTokenExchange(database, options.protection, {
      issuer: origin,
      signing: options.authorization,
    }),
    authorizationKeys: options.authorization.publicKeys,
    redemption: postgresCredentialRedemption(database, {
      audience: origin,
      protection: options.protection,
      finalize,
      nonces,
    }),
    /**
     * Describe the issuer and every published credential type as OpenID4VCI 1.0 Credential
     * Issuer Metadata.
     * @returns Endpoints and one credential configuration per published type, keyed by the type.
     * @throws Database errors if the published schema catalog cannot be read.
     */
    async metadata() {
      const { rows } = await database.query<{
        credential_type: string;
        name_sk: string | null;
        name_en: string | null;
      }>(`SELECT s.credential_type,s.name_sk,s.name_en FROM certificate_schemas s
        WHERE EXISTS(SELECT 1 FROM certificate_schema_versions v WHERE v.schema_id=s.id AND v.registered_at IS NOT NULL)
        ORDER BY s.credential_type COLLATE "C"`);
      return {
        credential_issuer: origin,
        authorization_servers: [origin],
        credential_endpoint: origin + '/credentials/',
        nonce_endpoint: origin + '/nonce',
        display: [
          { name: 'Atest', locale: 'sk' },
          { name: 'Atest', locale: 'en' },
        ],
        credential_configurations_supported: Object.fromEntries(
          rows.map((row) => [
            row.credential_type,
            {
              format: 'jwt_vc_json',
              scope: row.credential_type,
              cryptographic_binding_methods_supported: ['did:key'],
              credential_signing_alg_values_supported: ['ES256'],
              proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
              credential_definition: {
                type: ['VerifiableCredential', 'VerifiableAttestation', row.credential_type],
              },
              credential_metadata: {
                display: [
                  { name: row.name_sk || row.credential_type, locale: 'sk' },
                  { name: row.name_en || row.credential_type, locale: 'en' },
                ],
              },
            },
          ]),
        ),
      };
    },
    authorizationMetadata: {
      issuer: origin,
      token_endpoint: origin + '/auth/token',
      jwks_uri: origin + '/auth/jwks',
      grant_types_supported: [preAuthorizedGrant],
      // The holder presents the offer's code and PIN; it needs no client registration.
      'pre-authorized_grant_anonymous_access_supported': true,
      token_endpoint_auth_methods_supported: ['none'],
    },
  };
}
import type { Pool } from 'pg';
import type { IssuerOptions } from './types.ts';
