import { createHash, createPublicKey, verify } from 'node:crypto';
import { SignCommand } from '@aws-sdk/client-kms';

import { rawEcdsaSignature } from './kms-ecdsa.ts';
import type { JsonWebKey } from 'node:crypto';
import type { AssertionKeyResolver, AuthorizationSigning, CredentialKeyLoader } from './types.ts';
import type { Pool, PoolClient } from 'pg';
import { calculateJwkThumbprint } from 'jose';
import type { KmsSigningClient } from './kms-types.ts';
import { appendAudit } from '../audit/journal.ts';
import { transaction } from '../adapters/transaction.ts';

const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** Query executor needed to load the active issuer key within an optional transaction. */
interface IssuerKeyDatabase {
  query(
    text: string,
    values: string[],
  ): Promise<{
    rows: { kid: string; kms_key_id: string; public_jwk: JsonWebKey }[];
  }>;
}

/**
 * Create a loader for active TI or registry RootTAO KMS credential-signing keys.
 *
 * @param database - PostgreSQL query executor.
 * @param kms - KMS client.
 * @param assertionKey - Optional DID assertion-key resolver used to verify publication.
 * @param journal - Real pool owning the journal; supplied by runtime composition, omitted by isolated cryptographic checks.
 * @returns A loader accepting issuer DID, organization ID and optional transaction client.
 */
export function postgresKmsIssuerSigning(
  database: IssuerKeyDatabase,
  kms: KmsSigningClient,
  assertionKey: AssertionKeyResolver | undefined = undefined,
  journal?: Pool,
) {
  /**
   * Load and validate an issuer's active P-256 verification key.
   *
   * @param issuerDid - Issuer DID expected on the organization.
   * @param organizationId - TI or registry RootTAO organization ID.
   * @param client - Query executor; use the caller transaction to retain the key lock.
   * @returns The published kid and an ES256 signing operation.
   * @throws Error for a missing, invalid or unpublished key; database and DID-resolution errors.
   */
  async function signingKey(issuerDid: string, organizationId: string, client = database) {
    const {
      rows: [key],
    } = await client.query(
      `
      SELECT k.kid, k.kms_key_id, k.public_jwk
      FROM issuer_signing_keys k
      JOIN accredited_organizations o ON o.id = k.organization_id
      WHERE o.id = $1 AND o.kind IN ('ti','rtao') AND o.did = $2 AND k.active AND k.purpose = 'credential_signing'
      FOR SHARE OF k
    `,
      [organizationId, issuerDid],
    );
    if (!key) throw new Error('No active TI signing key.');
    const { kty, crv, x, y } = key.public_jwk;
    if (kty !== 'EC' || crv !== 'P-256') throw new Error('The issuer signing key must be P-256.');
    if (assertionKey) {
      const published = await assertionKey(issuerDid, key.kid);
      if (published.x !== x || published.y !== y) {
        throw new Error('The configured TI key does not match the published DID document.');
      }
    }
    const publicKey = createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' });

    return {
      kid: key.kid,
      publicJwk: { kty, crv, x, y },
      /**
       * Sign JWT input with KMS and verify the resulting ES256 signature.
       *
       * @param input - Exact JWT protected-header and payload bytes.
       * @returns A verified 64-byte JOSE signature.
       * @throws KMS or crypto errors, or Error for an invalid/mismatched signature.
       */
      async sign(input: Buffer) {
        const result = await kms.send(
          new SignCommand({
            KeyId: key.kms_key_id,
            Message: createHash('sha256').update(input).digest(),
            MessageType: 'DIGEST',
            SigningAlgorithm: 'ECDSA_SHA_256',
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (!result.Signature || result.SigningAlgorithm !== 'ECDSA_SHA_256') {
          throw new Error('KMS did not return an ES256 signature.');
        }
        const signature = rawEcdsaSignature(result.Signature, order);
        if (!verify('sha256', input, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) {
          throw new Error('KMS signature does not match the configured issuer verification key.');
        }
        if (journal) {
          const event = {
            event: 'key.signed',
            organizationId,
            detail: {
              key_id: key.kms_key_id,
              key_purpose: 'credential_signing',
              payload_digest: createHash('sha256').update(input).digest('hex'),
            },
          };
          if (client === database)
            await transaction(journal, (connection) => appendAudit(connection, event));
          else await appendAudit(client as unknown as Pick<PoolClient, 'query'>, event);
        }
        return signature;
      },
    };
  }
  return signingKey;
}

/**
 * Resolve the registry's authorization signing identity from existing key storage.
 * @param database - PostgreSQL pool.
 * @param loader - KMS credential-key loader, also supporting the registry RootTAO.
 * @param did - Existing configured registry DID, distinct from the issuing TI DID.
 * @returns Token signing and public-only key-history operations.
 * @throws Error when the registry DID is missing; operations propagate missing-key, database and KMS errors.
 */
export function postgresAuthorizationSigning(
  database: Pool,
  loader: CredentialKeyLoader,
  did: string,
): AuthorizationSigning {
  if (!did) throw new Error('Configure the existing registry DID for authorization tokens.');
  return {
    did,
    /**
     * Load the active registry credential-signing key for authorization tokens.
     * @param client - Caller transaction, or omitted for standalone lookup.
     * @returns The KMS-backed key and its public P-256 material.
     * @throws Error if the registry identity or key is unavailable; database, DID and KMS errors.
     */
    async key(client?: PoolClient) {
      const executor = client ?? database;
      const {
        rows: [organization],
      } = await executor.query(
        "SELECT id FROM accredited_organizations WHERE did=$1 AND kind='rtao'",
        [did],
      );
      if (!organization) throw new Error('No registry signing identity.');
      const key = await loader(did, organization.id, client);
      if (!key.publicJwk) throw new Error('No registry signing public key.');
      return { ...key, publicJwk: key.publicJwk };
    },
    /**
     * Publish active and retired registry assertion keys, excluding private material and pending keys.
     * @returns The protocol-compatible JWKS entries with thumbprint key IDs.
     * @throws Database or JWK thumbprint errors.
     */
    async publicKeys() {
      const { rows } = await database.query(
        `SELECT k.public_jwk FROM issuer_signing_keys k JOIN accredited_organizations o ON o.id=k.organization_id
        WHERE o.did=$1 AND o.kind='rtao' AND k.purpose='credential_signing' AND (k.active OR k.retired_at IS NOT NULL)`,
        [did],
      );
      return Promise.all(
        rows.map(async (row) => {
          const { kty, crv, x, y } = row.public_jwk;
          const publicJwk = { kty, crv, x, y };
          return { ...publicJwk, kid: await calculateJwkThumbprint(publicJwk), use: 'sig' };
        }),
      );
    },
  };
}
