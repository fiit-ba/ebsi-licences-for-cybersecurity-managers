import { createHash, createPrivateKey, sign } from 'node:crypto';
import { HDNodeWallet } from 'ethers';
import { calculateJwkThumbprint } from 'jose';
import type { Pool } from 'pg';
import type { EbsiActor, PublishedKey } from '../ebsi/publisher.ts';
import type { PublicEcKey } from '../ebsi/did-registry.ts';
import { trustChainCredential } from '../ebsi/credentials.ts';
import { relationships, type OrganizationPublication } from './onboarding.ts';

/** The public development mnemonic; the contracts' development keys use its path m/44'/60'/0'/0. */
const phrase = 'test test test test test test test test test test test junk';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * An appointed organization's own wallet, as the development bootstrap and the tests play it for
 * their own organizations. On EBSI each organization does this with its own wallet: registers its
 * DID, lists the back-office's keys in its DID document, and stores the accreditation it
 * downloaded in the Trusted Issuers Registry. The back-office itself never does it for them.
 * Development only: the key comes from the public development mnemonic.
 * @param database - Installation pool.
 * @param publication - The development EBSI runtime.
 * @param index - Which development wallet (m/44'/60'/0'/1/index).
 * @param fixedDid - The DID to register, when it is given (the governance contracts' TAO);
 * otherwise one derived from the wallet's key.
 * @returns The wallet's DID and its acts.
 */
export function developmentWallet(
  database: Pool,
  publication: OrganizationPublication,
  index: number,
  fixedDid?: string,
) {
  const wallet = walletKey(index);
  const point = Buffer.from(wallet.signingKey.publicKey.slice(4), 'hex');
  const publicJwk: PublicEcKey = {
    kty: 'EC',
    crv: 'secp256k1',
    x: point.subarray(0, 32).toString('base64url'),
    y: point.subarray(32).toString('base64url'),
  };
  const privateKey = createPrivateKey({
    key: { ...publicJwk, d: Buffer.from(wallet.privateKey.slice(2), 'hex').toString('base64url') },
    format: 'jwk',
  });
  // Its P-256 authentication key, from the same seed: the pilot's Trusted Issuers Registry takes
  // only ES256 presentations.
  const p256 = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('30310201010420', 'hex'),
      createHash('sha256')
        .update(wallet.privateKey + '|p-256')
        .digest(),
      Buffer.from('a00a06082a8648ce3d030107', 'hex'),
    ]),
    format: 'der',
    type: 'sec1',
  });
  const { d: _d, ...p256Jwk } = p256.export({ format: 'jwk' });
  const authenticationJwk = p256Jwk as PublicEcKey;
  const did = fixedDid ?? derivedDid(wallet.address);
  const { publisher, supportOffice } = publication.ebsi;
  if (!publisher || !supportOffice) throw new Error('The development wallet needs the EBSI mock.');

  /**
   * The wallet as a registry writer, signing with its own key.
   * @returns Its actor.
   */
  async function actor(): Promise<EbsiActor> {
    const kid = `${did}#${await calculateJwkThumbprint(publicJwk, 'sha256')}`;
    const authenticationKid = `${did}#${await calculateJwkThumbprint(authenticationJwk, 'sha256')}`;
    return {
      did,
      authentication: {
        alg: 'ES256',
        kid: authenticationKid,
        publicJwk: authenticationJwk,
        /**
         * Sign JWS input with the wallet's P-256 authentication key.
         * @param input - The JWS signing input.
         * @returns The raw r‖s signature.
         */
        async sign(input: Uint8Array) {
          return sign('sha256', input, { key: p256, dsaEncoding: 'ieee-p1363' });
        },
      },
      ledger: {
        signer: wallet.connect(publication.ebsi.provider),
        jws: {
          alg: 'ES256K',
          kid,
          publicJwk,
          /**
           * Sign JWS input with the wallet's own secp256k1 key.
           * @param input - The JWS signing input.
           * @returns The raw r‖s signature.
           */
          async sign(input: Uint8Array) {
            return sign('sha256', input, { key: privateKey, dsaEncoding: 'ieee-p1363' });
          },
        },
      },
    };
  }

  return {
    did,

    /**
     * Register the DID in the DID Registry with the wallet's own key, presenting the onboarding
     * authorisation (VerifiableAuthorisationToOnboard) its accreditor-to-be gives it. Once.
     * @param accreditorId - The RootTAO or TAO that gives the authorisation.
     * @returns Completion once the DID is registered.
     * @throws Registry, KMS, RPC or database errors.
     */
    async register(accreditorId: string) {
      if (await publisher.document(did)) return;
      const {
        rows: [accreditor],
      } = await database.query('SELECT did FROM accredited_organizations WHERE id=$1', [
        accreditorId,
      ]);
      const me = await actor();
      await supportOffice.fund(wallet.address);
      await publisher.ensureDid(
        me,
        async () =>
          trustChainCredential({
            signer: await publication.ebsi.jws(accreditorId, 'credential_signing'),
            issuer: accreditor.did,
            subject: did,
            type: 'VerifiableAuthorisationToOnboard',
            schemas: publication.trustChainSchemas.onboarding,
          }),
        new Date(Date.now() - 60_000),
      );
      // Its own keys authenticate the wallet too: the P-256 one signs ES256 presentations.
      await publisher.publishKeys(me, [
        {
          publicJwk,
          relationships: ['capabilityInvocation', 'authentication'],
          activatedAt: new Date(Date.now() - 60_000),
          retiredAt: null,
        },
        {
          publicJwk: authenticationJwk,
          relationships: ['authentication'],
          activatedAt: new Date(Date.now() - 60_000),
          retiredAt: null,
        },
      ]);
    },

    /**
     * Do the organization's part after it registered in the back-office: list the back-office's
     * keys in its DID document, then store the accreditation it downloaded, unless the registry
     * holds it already.
     * @param organizationId - The organization in the back-office.
     * @returns Completion.
     * @throws Error before the accreditation is issued; registry, RPC or database errors.
     */
    async complete(organizationId: string) {
      const me = await actor();
      await supportOffice.fund(wallet.address);
      const { rows } = await database.query(
        `SELECT purpose,public_jwk,activated_at,retired_at FROM issuer_signing_keys
         WHERE organization_id=$1 AND purpose=ANY($2::text[]) AND activated_at IS NOT NULL
         ORDER BY activated_at,kid`,
        [organizationId, Object.keys(relationships)],
      );
      const keys: PublishedKey[] = rows.map((row) => ({
        publicJwk: row.public_jwk,
        relationships: [...relationships[row.purpose as keyof typeof relationships]],
        activatedAt: row.activated_at,
        retiredAt: row.retired_at,
      }));
      await publisher.publishKeys(me, keys);
      const {
        rows: [organization],
      } = await database.query(
        'SELECT accreditation_credential FROM accredited_organizations WHERE id=$1',
        [organizationId],
      );
      const credential: string | null = organization?.accreditation_credential;
      if (!credential) throw new Error('The organization has no accreditation to store yet.');
      const attributeId = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString())
        .vc.credentialSubject.reservedAttributeId;
      const stored = await publisher.attribute(did, attributeId);
      const body = typeof stored?.body === 'string' ? stored.body : '';
      if (
        body === credential ||
        Buffer.from(body.replace(/^0x/, ''), 'hex').toString() === credential
      )
        return;
      await publisher.store(me, attributeId, credential);
    },
  };
}

/**
 * A development wallet's key.
 * @param index - Which development wallet.
 * @returns Its key at m/44'/60'/0'/1/index of the public development mnemonic.
 */
function walletKey(index: number) {
  return HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/1/${index}`);
}

/**
 * The DID a development wallet registers when none is given.
 * @param index - Which development wallet.
 * @returns Its derived did:ebsi.
 */
export function developmentWalletDid(index: number) {
  return derivedDid(walletKey(index).address);
}

/**
 * A legal entity's did:ebsi derived from an address, so a development wallet keeps its DID.
 * @param address - The wallet's address.
 * @returns `did:ebsi:z` and the base58 of version byte 1 and 16 bytes of the address's hash.
 */
function derivedDid(address: string) {
  const bytes = Buffer.concat([
    Buffer.from([1]),
    createHash('sha256').update(address.toLowerCase()).digest().subarray(0, 16),
  ]);
  let value = BigInt('0x' + bytes.toString('hex'));
  let encoded = '';
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return 'did:ebsi:z' + encoded;
}
