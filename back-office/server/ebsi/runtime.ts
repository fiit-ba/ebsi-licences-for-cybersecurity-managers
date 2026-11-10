import { KMSClient } from '@aws-sdk/client-kms';
import { Transaction, computeAddress, getAddress, type Signer } from 'ethers';
import type { Pool } from 'pg';
import { kmsLedgerSigner } from '../issuance/kms-ledger-signer.ts';
import { kmsJwsSigner, type JwsSigner } from '../keys/kms-jws.ts';
import { publicEcKey } from './did-registry.ts';
import { ebsiAuthorisation } from './authorisation.ts';
import { EbsiLedgerProvider } from './ledger.ts';
import { ebsiPublisher, type EbsiActor } from './publisher.ts';
import { developmentSupportOffice } from './support-office.ts';

/** Organization key purposes that sign ledger transactions (secp256k1). */
export const ledgerPurposes = [
  'ledger_transactions',
  'governance_role_a',
  'governance_role_b',
] as const;
/** A key purpose that signs ledger transactions. */
export type LedgerPurpose = (typeof ledgerPurposes)[number];

/**
 * The Ethereum address of a secp256k1 public JWK.
 * @param jwk - Stored public key.
 * @returns Its checksummed address.
 * @throws DidResolutionError for a malformed key.
 */
export function jwkAddress(jwk: unknown) {
  const key = publicEcKey(jwk, 'secp256k1');
  return computeAddress(
    '0x04' +
      Buffer.from(key.x, 'base64url').toString('hex') +
      Buffer.from(key.y, 'base64url').toString('hex'),
  );
}

/**
 * Compose EBSI Core API v1 access for this installation: the Authorisation client, the Ledger
 * API as a token-carrying provider, the DID/TIR publisher and the organizations' KMS signers.
 *
 * @param database - PostgreSQL pool.
 * @param env - `PLR_EBSI_URL`, `PLR_LEDGER_RPC_URL`, `PLR_LEDGER_CHAIN_ID`, KMS and the
 * optional development `PLR_EBSI_MOCK_URL`.
 * @param contracts - The Trusted Contracts a `ledger:invoke` token is presented for.
 * @param client - KMS client to sign with; omitted, one for `PLR_KMS_ENDPOINT_URL`.
 * @returns The runtime, or undefined when no ledger is configured.
 * @throws Error for invalid configuration.
 * @remarks Every signed transaction goes through the Ledger API with a token for the DID that
 * owns its key; reads need none. `PLR_EBSI_URL` unset means a plain JSON-RPC ledger, as in
 * isolated tests.
 */
export function configuredEbsi(
  database: Pool,
  env = process.env,
  contracts: string[] = [],
  client?: KMSClient,
) {
  if (!env.PLR_LEDGER_RPC_URL) return undefined;
  const chainId = Number(env.PLR_LEDGER_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId < 1)
    throw new Error('PLR_LEDGER_CHAIN_ID must be a positive integer.');
  const baseUrl = env.PLR_EBSI_URL?.trim() || undefined;
  const auth = baseUrl ? ebsiAuthorisation({ baseUrl }) : undefined;
  const kms =
    client ??
    new KMSClient({
      region: env.AWS_REGION,
      endpoint: env.PLR_KMS_ENDPOINT_URL || undefined,
    });
  const invoke = new Set(contracts.filter(Boolean).map((address) => getAddress(address)));
  const signers = new Map<string, Promise<Signer & { keyId: string }>>();
  const owners = new Map<string, { organizationId: string; did: string }>();

  /**
   * Load an organization's active key of one purpose.
   * @param organizationId - Organization UUID.
   * @param purpose - Key purpose.
   * @returns The DID, kid, KMS locator and public key.
   * @throws Error when the organization holds no active key of that purpose.
   */
  async function activeKey(organizationId: string, purpose: string) {
    const {
      rows: [key],
    } = await database.query(
      `SELECT o.did,k.kid,k.kms_key_id,k.public_jwk FROM issuer_signing_keys k
       JOIN accredited_organizations o ON o.id=k.organization_id
       WHERE k.organization_id=$1 AND k.purpose=$2 AND k.active`,
      [organizationId, purpose],
    );
    if (!key?.did) throw new Error(`The organization holds no active ${purpose} key.`);
    return key as { did: string; kid: string; kms_key_id: string; public_jwk: unknown };
  }

  /**
   * Find the organization a ledger key belongs to.
   * @param address - Sending address.
   * @returns Organization and DID, or undefined for a key not held here.
   */
  async function ownerOf(address: string) {
    const known = owners.get(getAddress(address));
    if (known) return known;
    const { rows } = await database.query(
      `SELECT o.id,o.did,k.public_jwk FROM issuer_signing_keys k JOIN accredited_organizations o ON o.id=k.organization_id
       WHERE k.purpose=ANY($1::text[]) AND o.did IS NOT NULL`,
      [[...ledgerPurposes]],
    );
    for (const row of rows)
      owners.set(jwkAddress(row.public_jwk), { organizationId: row.id, did: row.did });
    return owners.get(getAddress(address));
  }

  const provider = new EbsiLedgerProvider(
    env.PLR_LEDGER_RPC_URL,
    chainId,
    auth &&
      (async (raw, fresh) => {
        const tx = Transaction.from(raw);
        if (!tx.to || !invoke.has(getAddress(tx.to)) || !tx.from) return undefined;
        const owner = await ownerOf(tx.from);
        if (!owner) return undefined;
        const {
          rows: [organization],
        } = await database.query(
          'SELECT ebsi_invoke_credential FROM accredited_organizations WHERE id=$1',
          [owner.organizationId],
        );
        if (!organization?.ebsi_invoke_credential)
          throw new Error(
            'The organization holds no EBSI authorisation for the Trusted Contracts.',
          );
        if (fresh) auth.forget(owner.did, 'ledger:invoke');
        return auth.token({
          scope: 'ledger:invoke',
          holder: owner.did,
          signer: await jws(owner.organizationId, 'ledger_transactions'),
          credential: organization.ebsi_invoke_credential,
        });
      }),
  );

  /**
   * A JWS signer for an organization's active key of one purpose.
   * @param organizationId - Organization UUID.
   * @param purpose - Key purpose.
   * @returns The KMS-backed signer named by the key's DID URL.
   * @throws Error for a missing key.
   */
  async function jws(organizationId: string, purpose: string): Promise<JwsSigner> {
    const key = await activeKey(organizationId, purpose);
    return kmsJwsSigner(kms, {
      kmsKeyId: key.kms_key_id,
      publicJwk: publicEcKey(key.public_jwk),
      kid: key.kid,
    });
  }

  /**
   * A transaction signer for an organization's active ledger key of one purpose.
   * @param organizationId - Organization UUID.
   * @param purpose - Ledger key purpose.
   * @returns The pinned KMS signer on the Ledger API provider.
   * @throws Error for a missing key or a KMS key that does not match the stored one.
   */
  function ledgerSigner(organizationId: string, purpose: LedgerPurpose) {
    const cacheKey = organizationId + ':' + purpose;
    let signer = signers.get(cacheKey);
    if (!signer) {
      signer = (async () => {
        const key = await activeKey(organizationId, purpose);
        const created = await kmsLedgerSigner({ provider, kms, keyId: key.kms_key_id, chainId });
        if ((await created.getAddress()) !== jwkAddress(key.public_jwk))
          throw new Error('The KMS key does not match the stored ledger key.');
        owners.set(await created.getAddress(), { organizationId, did: key.did });
        return created;
      })().catch((error) => {
        signers.delete(cacheKey);
        throw error;
      });
      signers.set(cacheKey, signer);
    }
    return signer;
  }

  return {
    chainId,
    provider,
    kms,
    auth,
    publisher:
      auth && baseUrl ? ebsiPublisher({ database, baseUrl, provider, auth, chainId }) : undefined,
    supportOffice: developmentSupportOffice(env.PLR_EBSI_MOCK_URL),
    jws,
    ledgerSigner,
    /**
     * The organization as a registry writer: its DID, attribute and ledger key.
     * @param organizationId - Organization UUID.
     * @returns The actor.
     * @throws Error for a missing key.
     */
    async actor(organizationId: string): Promise<EbsiActor> {
      const {
        rows: [organization],
      } = await database.query(
        'SELECT did,tir_attribute_id FROM accredited_organizations WHERE id=$1',
        [organizationId],
      );
      return {
        did: organization.did,
        attributeId: /^0x[0-9a-f]{64}$/.test(organization.tir_attribute_id ?? '')
          ? organization.tir_attribute_id
          : undefined,
        ledger: {
          signer: await ledgerSigner(organizationId, 'ledger_transactions'),
          jws: await jws(organizationId, 'ledger_transactions'),
        },
      };
    },
    /** Release the provider and KMS client. @returns No return value. */
    close() {
      provider.destroy();
      // An injected client belongs to its caller.
      if (!client) kms.destroy();
    },
  };
}

/** EBSI Core API v1 access for one installation. */
export type EbsiRuntime = NonNullable<ReturnType<typeof configuredEbsi>>;
