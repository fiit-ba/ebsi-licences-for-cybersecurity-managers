import { AbiCoder, Interface, hexlify, sha256, toUtf8Bytes, type Signer } from 'ethers';
import { calculateJwkThumbprint } from 'jose';
import type { Pool } from 'pg';
import type { JwsSigner } from '../keys/kms-jws.ts';
import type { DidRelationship, PublicEcKey } from './did-registry.ts';
import type { EbsiAuthorisation, EbsiScope } from './authorisation.ts';
import { sendRegistryTransaction, type EbsiLedgerProvider } from './ledger.ts';

/** The DID and TIR writes this back-office makes (EBSI's DidRegistry and IssuersRegistry). */
const didRegistry = new Interface([
  'function insertDidDocument(string did, string baseDocument, string vMethodId, bytes publicKey, bool isSecp256k1, uint256 notBefore, uint256 notAfter) returns (bool)',
  'function addVerificationMethod(string did, string vMethodId, bytes publicKey, bool isSecp256k1) returns (bool)',
  'function addVerificationRelationship(string did, string name, string vMethodId, uint256 notBefore, uint256 notAfter) returns (bool)',
  'function revokeVerificationMethod(string did, string vMethodId, uint256 notAfter) returns (bool)',
  'error DidAlreadyExists()',
  'error VMethodIdAlreadyExists()',
  'error RelationshipAlreadyExists()',
  'error CapabilityInvocationAlreadyExists()',
  'error VMethodIdAlreadyRevoked()',
  'error NotControllerNorAuthorisedForPolicy(string policy)',
  'error InvalidDates()',
]);
const issuersRegistry = new Interface([
  'function setAttributeMetadata(string did, bytes32 revisionId, uint8 issuerType, string taoDid, bytes32 attributeIdTao)',
  'function setAttributeData(string did, bytes32 attributeId, bytes attributeData)',
  'error AttributeAlreadyRevoked()',
  'error NotTheIssuerItself()',
  'error PolicyAttributeMissing(string policy)',
  'error PolicyNotTaoOrRootTao(string policy)',
  'error PolicyNotTaoOrRootTaoOfDid(string did, string policy)',
  'error TrustChainBroken(string reason)',
]);
const issuerTypes = { RootTAO: 1, TAO: 2, TI: 3, Revoked: 4 } as const;
const baseDocument = JSON.stringify({
  '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
});
const fiftyYears = 50 * 365 * 24 * 3600;

/** A DID that writes to EBSI's registries: its capabilityInvocation key signs its transactions and presentations. */
export interface EbsiActor {
  did: string;
  /** Its accreditation attribute, when it accredits others. */
  attributeId?: string;
  ledger: { signer: Signer; jws: JwsSigner };
}

/** A public key and the DID relationships it holds, with its active window. */
export interface PublishedKey {
  publicJwk: PublicEcKey;
  relationships: DidRelationship[];
  activatedAt: Date;
  retiredAt: Date | null;
}

/** A registry refusal, decoded from the revert so callers can tell "already done" from a real failure. */
export class RegistryRefusal extends Error {
  readonly reason: string;

  /**
   * Name the registry's custom error.
   * @param reason - Custom error name, such as DidAlreadyExists.
   */
  constructor(reason: string) {
    super(`The EBSI registry refused the transaction: ${reason}.`);
    this.reason = reason;
  }
}

/**
 * The bytes the DID Registry keeps for a key: raw for secp256k1, JWK JSON otherwise.
 * @param jwk - Public key.
 * @returns Hex bytes and the registry's secp256k1 flag.
 */
export function registryKeyBytes(jwk: PublicEcKey) {
  if (jwk.crv === 'secp256k1')
    return {
      publicKey: hexlify(
        Buffer.concat([
          Buffer.from([4]),
          Buffer.from(jwk.x, 'base64url'),
          Buffer.from(jwk.y, 'base64url'),
        ]),
      ),
      isSecp256k1: true,
    };
  const { kty, crv, x, y } = jwk;
  return {
    publicKey: hexlify(toUtf8Bytes(JSON.stringify({ kty, crv, x, y }))),
    isSecp256k1: false,
  };
}

/**
 * The attribute an accreditor creates for a subject: the same for the same parties and type.
 * @param subjectDid - Accredited DID.
 * @param accreditorDid - Accrediting DID.
 * @param type - TAO or TI.
 * @returns The salt passed to setAttributeMetadata and the attribute id the registry derives from it.
 */
export function attributeFor(subjectDid: string, accreditorDid: string, type: 'TAO' | 'TI') {
  const salt = sha256(toUtf8Bytes(`atest-attribute|${subjectDid}|${accreditorDid}|${type}`));
  // IssuersRegistry._deriveRevisionId(did, salt, 0, "") for a first revision.
  const attributeId = sha256(
    AbiCoder.defaultAbiCoder().encode(
      ['string', 'bytes32', 'uint256', 'bytes'],
      [subjectDid, salt, 0, '0x'],
    ),
  );
  return { salt, attributeId };
}

/**
 * Create the Core API v1 publisher of DIDs, keys and accreditations.
 *
 * @param options - Database (per-key send serialization), Core API base, Ledger provider,
 * Authorisation client, chain and HTTP transport.
 * @returns Idempotent registry reads and writes.
 * @remarks Every write is simulated first, so a refusal names the registry's error before a
 * signature is requested. Writes per key are serialized with the same session lock the
 * audited governance signer uses, so a key never races itself for a nonce.
 */
export function ebsiPublisher(options: {
  database: Pool;
  baseUrl: string;
  provider: EbsiLedgerProvider;
  auth: EbsiAuthorisation;
  chainId: number;
  fetchApi?: typeof fetch;
}) {
  const { database, provider, auth, chainId } = options;
  const request = options.fetchApi ?? fetch;
  const root = options.baseUrl.replace(/\/+$/, '');
  let addresses: Promise<{ didRegistry: string; issuersRegistry: string }> | undefined;

  /**
   * Read one JSON resource of the Core API.
   * @param path - Path under the base.
   * @param accept - Optional Accept header.
   * @returns The JSON, or undefined for 404.
   * @throws Error for other failures.
   */
  async function read(path: string, accept?: string) {
    const response = await request(root + path, {
      headers: accept ? { accept } : {},
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) throw new Error(`EBSI answered HTTP ${response.status} for ${path}.`);
    return response.json();
  }

  /**
   * The registry contracts, as their `/details` endpoints name them.
   * @returns DID and Issuers Registry addresses.
   * @throws Error when the details are unavailable.
   */
  function registries() {
    addresses ??= (async () => {
      const [did, tir] = await Promise.all([
        read('/v1/did-registry/details'),
        read('/v1/issuers-registry/details'),
      ]);
      if (!did?.contractAddress || !tir?.contractAddress)
        throw new Error('EBSI names no registry contracts.');
      return { didRegistry: did.contractAddress, issuersRegistry: tir.contractAddress };
    })().catch((error) => {
      addresses = undefined;
      throw error;
    });
    return addresses;
  }

  /**
   * Decode a revert into the registry's error name.
   * @param error - Error from a simulation or send.
   * @returns The custom error name, if any.
   */
  function revertReason(error: unknown) {
    const value = error as {
      data?: string;
      info?: { error?: { data?: string } };
      revert?: { name?: string };
    };
    const data = value?.data ?? value?.info?.error?.data;
    for (const abi of [didRegistry, issuersRegistry]) {
      try {
        const parsed = data ? abi.parseError(data) : null;
        if (parsed) return parsed.name;
      } catch {
        // Not this registry's error.
      }
    }
    return value?.revert?.name;
  }

  /**
   * Sign and send one registry write under a token for the scope, serialized per key.
   * @param actor - Sending DID.
   * @param scope - Token scope.
   * @param to - Registry contract.
   * @param data - Calldata.
   * @param credential - Credential the scope asks for, if not a self-attestation.
   * @returns Completion when mined.
   * @throws RegistryRefusal for a registry revert; token, KMS and RPC errors.
   */
  async function transact(
    actor: EbsiActor,
    scope: EbsiScope,
    to: string,
    data: string,
    credential?: string,
  ) {
    const address = await actor.ledger.signer.getAddress();
    const lock = await database.connect();
    const lockKey = chainId + ':' + address;
    try {
      await lock.query('SELECT pg_advisory_lock(780264154,hashtext($1))', [lockKey]);
      try {
        await provider.call({ from: address, to, data });
      } catch (error) {
        const reason = revertReason(error);
        if (reason) throw new RegistryRefusal(reason);
        throw error;
      }
      for (const fresh of [false, true]) {
        if (fresh) auth.forget(actor.did, scope);
        const token = await auth.token({
          scope,
          holder: actor.did,
          signer: actor.ledger.jws,
          credential,
        });
        try {
          await sendRegistryTransaction({ provider, signer: actor.ledger.signer, to, data, token });
          return;
        } catch (error) {
          if ((error as { code?: unknown })?.code !== 'TOKEN_REFUSED' || fresh) throw error;
        }
      }
    } finally {
      try {
        await lock.query('SELECT pg_advisory_unlock(780264154,hashtext($1))', [lockKey]);
      } finally {
        lock.release();
      }
    }
  }

  /**
   * Read a DID document.
   * @param did - The DID.
   * @param at - Optional historical moment.
   * @returns The document without @context, or undefined when not registered.
   */
  async function document(did: string, at?: Date) {
    const query = at ? `?valid-at=${encodeURIComponent(at.toISOString())}` : '';
    return read(`/v1/did-registry/identifiers/${did}${query}`, 'application/did+json');
  }

  /**
   * Read an attribute's latest revision.
   * @param did - Attribute owner.
   * @param attributeId - Canonical attribute id.
   * @returns `{body, issuerType, tao, rootTao, hash}`, or undefined.
   */
  async function attribute(did: string, attributeId: string) {
    return (await read(`/v1/issuers-registry/issuers/${did}/attributes/${attributeId}`))?.attribute;
  }

  return {
    registries,
    document,
    attribute,

    /**
     * Register a DID with its capabilityInvocation key, once.
     * @param actor - The DID and the key it registers with.
     * @param onboarding - Supplies the VerifiableAuthorisationToOnboard it presents.
     * @param notBefore - When the key became valid.
     * @returns Whether it was registered now.
     * @throws Registry, token, KMS or RPC errors.
     */
    async ensureDid(actor: EbsiActor, onboarding: () => Promise<string>, notBefore: Date) {
      if (await document(actor.did)) return false;
      const jwk = actor.ledger.jws.publicJwk;
      const { publicKey, isSecp256k1 } = registryKeyBytes(jwk);
      if (!isSecp256k1) throw new Error('A DID is registered with its secp256k1 ledger key.');
      const from = Math.floor(+notBefore / 1000);
      const data = didRegistry.encodeFunctionData('insertDidDocument', [
        actor.did,
        baseDocument,
        await calculateJwkThumbprint(jwk, 'sha256'),
        publicKey,
        true,
        from,
        Math.floor(Date.now() / 1000) + fiftyYears,
      ]);
      try {
        await transact(
          actor,
          'did-registry:invite',
          (await registries()).didRegistry,
          data,
          await onboarding(),
        );
      } catch (error) {
        if (!(error instanceof RegistryRefusal && error.reason === 'DidAlreadyExists')) throw error;
      }
      return true;
    },

    /**
     * Make the DID document show exactly these keys in these relationships, retiring retired ones.
     * @param actor - The DID, writing with its capabilityInvocation key.
     * @param keys - Keys with relationships and windows; the ledger key itself may be included.
     * @returns The number of registry writes made.
     * @throws Registry, token, KMS or RPC errors.
     */
    async publishKeys(actor: EbsiActor, keys: PublishedKey[]) {
      const { didRegistry: to } = await registries();
      const current = (await document(actor.did)) ?? {};
      const listed = (relationship: string, id: string) =>
        Array.isArray(current[relationship]) && current[relationship].includes(id);
      let writes = 0;
      const now = Math.floor(Date.now() / 1000);
      for (const key of keys) {
        const vMethodId = await calculateJwkThumbprint(key.publicJwk, 'sha256');
        const id = `${actor.did}#${vMethodId}`;
        if (key.retiredAt) {
          if (!key.relationships.some((relationship) => listed(relationship, id))) continue;
          const until = Math.min(now, Math.floor(+key.retiredAt / 1000));
          try {
            await transact(
              actor,
              'did-registry:write',
              to,
              didRegistry.encodeFunctionData('revokeVerificationMethod', [
                actor.did,
                vMethodId,
                until,
              ]),
            );
            writes++;
          } catch (error) {
            if (!(error instanceof RegistryRefusal && error.reason === 'VMethodIdAlreadyRevoked'))
              throw error;
          }
          continue;
        }
        const missing = key.relationships.filter((relationship) => !listed(relationship, id));
        if (!missing.length) continue;
        const { publicKey, isSecp256k1 } = registryKeyBytes(key.publicJwk);
        try {
          await transact(
            actor,
            'did-registry:write',
            to,
            didRegistry.encodeFunctionData('addVerificationMethod', [
              actor.did,
              vMethodId,
              publicKey,
              isSecp256k1,
            ]),
          );
          writes++;
        } catch (error) {
          if (!(error instanceof RegistryRefusal && error.reason === 'VMethodIdAlreadyExists'))
            throw error;
        }
        for (const relationship of missing) {
          try {
            await transact(
              actor,
              'did-registry:write',
              to,
              didRegistry.encodeFunctionData('addVerificationRelationship', [
                actor.did,
                relationship,
                vMethodId,
                Math.floor(+key.activatedAt / 1000),
                now + fiftyYears,
              ]),
            );
            writes++;
          } catch (error) {
            if (!(
              error instanceof RegistryRefusal &&
              ['RelationshipAlreadyExists', 'CapabilityInvocationAlreadyExists'].includes(
                error.reason,
              )
            ))
              throw error;
          }
        }
      }
      return writes;
    },

    /**
     * Create a subject's accreditation attribute as its accreditor, once.
     * @param accreditor - TAO or RootTAO, with its own attribute.
     * @param subjectDid - Accredited DID.
     * @param type - TAO or TI.
     * @returns The attribute id the subject stores its accreditation under.
     * @throws Registry, token, KMS or RPC errors.
     */
    async accredit(accreditor: EbsiActor, subjectDid: string, type: 'TAO' | 'TI') {
      if (!accreditor.attributeId)
        throw new Error('The accreditor holds no accreditation of its own.');
      const { salt, attributeId } = attributeFor(subjectDid, accreditor.did, type);
      if (await attribute(subjectDid, attributeId)) return attributeId;
      await transact(
        accreditor,
        'issuers-registry:write',
        (await registries()).issuersRegistry,
        issuersRegistry.encodeFunctionData('setAttributeMetadata', [
          subjectDid,
          salt,
          issuerTypes[type],
          accreditor.did,
          accreditor.attributeId,
        ]),
      );
      return attributeId;
    },

    /**
     * Store a subject's accreditation credential under its attribute, as the subject.
     * @param subject - Accredited DID.
     * @param attributeId - Its attribute.
     * @param credential - The accreditation it presents and stores.
     * @returns Completion when stored.
     * @throws Registry, token, KMS or RPC errors.
     */
    async store(subject: EbsiActor, attributeId: string, credential: string) {
      await transact(
        subject,
        'issuers-registry:invite',
        (await registries()).issuersRegistry,
        issuersRegistry.encodeFunctionData('setAttributeData', [
          subject.did,
          attributeId,
          hexlify(toUtf8Bytes(credential)),
        ]),
        credential,
      );
    },

    /**
     * Revoke a subject's accreditation as its accreditor; revoking twice changes nothing.
     * @param accreditor - TAO or RootTAO that accredited it.
     * @param subjectDid - Accredited DID.
     * @param attributeId - The subject's attribute.
     * @returns Whether it was revoked now.
     * @throws Registry, token, KMS or RPC errors.
     */
    async revoke(accreditor: EbsiActor, subjectDid: string, attributeId: string) {
      const current = await attribute(subjectDid, attributeId);
      if (!current || current.issuerType === 'Revoked') return false;
      try {
        await transact(
          accreditor,
          'issuers-registry:write',
          (await registries()).issuersRegistry,
          issuersRegistry.encodeFunctionData('setAttributeMetadata', [
            subjectDid,
            attributeId,
            issuerTypes.Revoked,
            accreditor.did,
            accreditor.attributeId,
          ]),
        );
      } catch (error) {
        if (!(error instanceof RegistryRefusal && error.reason === 'AttributeAlreadyRevoked'))
          throw error;
      }
      return true;
    },
  };
}

/** Core API v1 publisher of DIDs, keys and accreditations. */
export type EbsiPublisher = ReturnType<typeof ebsiPublisher>;
