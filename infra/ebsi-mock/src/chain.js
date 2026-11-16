// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * EBSI's registries as this service reads them: the DID, Trusted Issuers,
 * Trusted Schemas and Timestamp contracts of contracts/local/ebsi-mock,
 * deployed on the development ledger. The chain is the only state; nothing is
 * kept in memory, so a restart loses nothing.
 *
 * Also the two keys that stand in for EBSI's own people on a development
 * chain: its operator (the Policies Registry's admin, the deployer) and its
 * Support Office (which accredits RootTAOs and grants access to contracts).
 */

import {Contract, FetchRequest, JsonRpcProvider, Wallet, isError} from 'ethers';
import {DID_REGISTRY_ABI, ISSUERS_REGISTRY_ABI, POLICIES_REGISTRY_ABI, SCHEMAS_REGISTRY_ABI, TIMESTAMP_ABI} from './abis.js';
import {methodJwk, registryKey, secp256k1Jwk, thumbprint} from './keys.js';
import {DEVELOPMENT_CHAINS} from './config.js';

/** DID document relationships, in the order a DID document lists them. */
export const RELATIONSHIPS = ['authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation'];

/** Policies a development chain needs: who may write which registry (Policies Registry names). */
const POLICIES = {
  'Timestamp:insertHashAlgorithm': "Offer a hash algorithm for timestamps (EBSI's operator)",
  'IssuersRegistry:setAttributeMetadata': 'Accredit RootTAOs (the Support Office)',
  'SchemasRegistry:insertSchema': 'Register a schema (the Support Office)',
  'SchemasRegistry:updateSchema': 'Update a schema (the Support Office)',
  'SchemasRegistry:updateMetadata': 'Update schema metadata (the Support Office)',
};

/**
 * Connect to the ledger and EBSI's contracts on it.
 * @param {object} config From readConfig.
 * @returns {object} Contracts, wallets and the reads the API answers from.
 */
export function connectChain(config) {
  const request = new FetchRequest(config.rpc);
  // As long as a verifier waits for the ledger (at least 30 s), so this
  // service is not the one to give up first.
  request.timeout = 30_000;
  const provider = new JsonRpcProvider(request, undefined, {staticNetwork: false, cacheTimeout: -1});
  const missing = Object.entries(config.contracts)
    .filter(([, address]) => !address)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(
      `No address for ${missing.join(', ')}: deploy contracts/scripts/DeployEBSI.s.sol and mount its record (MOCK_EBSI_DEPLOYMENT).`,
    );
  const admin = new Wallet(config.adminKey, provider);
  const supportOffice = new Wallet(config.supportOffice.key, provider);
  const supervisor = config.supervisor?.did ? new Wallet(config.supervisor.key, provider) : undefined;
  const contracts = {
    didRegistry: new Contract(config.contracts.didRegistry, DID_REGISTRY_ABI, provider),
    issuersRegistry: new Contract(config.contracts.issuersRegistry, ISSUERS_REGISTRY_ABI, provider),
    schemasRegistry: new Contract(config.contracts.schemasRegistry, SCHEMAS_REGISTRY_ABI, provider),
    timestamp: new Contract(config.contracts.timestamp, TIMESTAMP_ABI, provider),
    policiesRegistry: new Contract(config.contracts.policiesRegistry, POLICIES_REGISTRY_ABI, provider),
  };

  // One transaction at a time per key: the operator's and the Support
  // Office's nonces are this service's to keep.
  const queues = new Map();
  /**
   * Send a transaction from one of this service's keys and wait for it.
   * @param {Wallet} wallet The sending key.
   * @param {(signer: Wallet) => Promise<any>} build Sends the transaction.
   * @returns {Promise<any>} The mined receipt.
   */
  function send(wallet, build) {
    const previous = queues.get(wallet.address) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const response = await build(wallet);
        const receipt = await response.wait(1, 60_000);
        if (!receipt || receipt.status !== 1) throw new Error('The transaction reverted');
        return receipt;
      });
    queues.set(wallet.address, next);
    return next;
  }

  /**
   * A DID document as the registry holds it at a moment.
   * @param {string} did The DID.
   * @param {number} [at] Unix seconds; now when omitted.
   * @returns {Promise<object|undefined>} The document, or nothing for an unknown DID.
   */
  async function didDocument(did, at) {
    const read = at === undefined ? contracts.didRegistry.getDidDocument(did) : contracts.didRegistry.getDidDocumentByTimestamp(did, at);
    let result;
    try {
      result = await read;
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return undefined;
      throw error;
    }
    const [baseDocument, controllers, vMethodIds, vMethods, relationships] = result;
    if (!baseDocument) return undefined;
    let base = {};
    try {
      base = JSON.parse(baseDocument);
    } catch {
      base = {};
    }
    const verificationMethod = [];
    vMethodIds.forEach((vMethodId, index) => {
      const publicKeyJwk = methodJwk(vMethods[index]);
      if (!publicKeyJwk) return;
      verificationMethod.push({
        id: `${did}#${vMethodId}`,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk,
      });
    });
    const document = {
      '@context': base['@context'] ?? ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
      id: did,
      controller: [...controllers],
      verificationMethod,
    };
    for (const name of RELATIONSHIPS) {
      const ids = [...new Set(relationships.filter((item) => item.name === name).map((item) => `${did}#${item.vMethodId}`))];
      if (ids.length) document[name] = ids.filter((id) => verificationMethod.some((method) => method.id === id));
    }
    return document;
  }

  /**
   * The public key behind a DID URL, if the DID document puts it in one of the relationships.
   * @param {string} kid DID URL, `did#vMethodId`.
   * @param {string[]} relationships Acceptable relationships.
   * @param {number} [at] Unix seconds; now when omitted.
   * @returns {Promise<object|undefined>} The JWK.
   */
  async function keyOf(kid, relationships, at) {
    if (typeof kid !== 'string' || !kid.includes('#')) return undefined;
    const did = kid.slice(0, kid.indexOf('#'));
    const document = await didDocument(did, at);
    if (!document) return undefined;
    const allowed = relationships.some((name) => (document[name] ?? []).includes(kid));
    if (!allowed) return undefined;
    return document.verificationMethod.find((method) => method.id === kid)?.publicKeyJwk;
  }

  /**
   * The latest revision of every attribute of an issuer, newest last.
   * @param {string} did Issuer DID.
   * @returns {Promise<object[]|undefined>} Attributes, or nothing for an unknown issuer.
   */
  async function issuerAttributes(did) {
    const ids = [];
    for (let page = 1; page < 1000; page++) {
      let result;
      try {
        result = await contracts.issuersRegistry.getIssuerAttributes(did, page, 50);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION')) return page === 1 ? undefined : ids;
        throw error;
      }
      ids.push(...result.items);
      if (!result.items.length || BigInt(ids.length) >= result.total) break;
    }
    return ids;
  }

  /**
   * An attribute's latest revision.
   * @param {string} did Issuer DID.
   * @param {string} attributeId Canonical attribute id, 0x-hex.
   * @returns {Promise<object|undefined>} The revision, or nothing.
   */
  async function attribute(did, attributeId) {
    try {
      return await contracts.issuersRegistry.getLatestRevisionAttribute(did, attributeId);
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return undefined;
      throw error;
    }
  }

  /**
   * Fund a development key with gas, once it runs low. Development chains only.
   * @param {string} address Key to fund.
   * @returns {Promise<boolean>} Whether a transfer was made.
   */
  async function fund(address) {
    const {chainId} = await provider.getNetwork();
    if (!DEVELOPMENT_CHAINS.has(chainId)) throw new Error('Funding is a development-chain convenience only.');
    if ((await provider.getBalance(address)) >= config.funding / 10n) return false;
    await send(admin, (signer) => signer.sendTransaction({to: address, value: config.funding}));
    return true;
  }

  /**
   * Make a development chain ready for the Support Office and its policies.
   * Idempotent: every step checks the chain first.
   * @param {object} supportOfficeKeys The Support Office's assertion key (P-256).
   * @returns {Promise<void>}
   */
  async function ensureGenesis(supportOfficeKeys) {
    const {chainId} = await provider.getNetwork();
    if (!DEVELOPMENT_CHAINS.has(chainId))
      throw new Error('This service plays EBSI on a development chain only (1337 or 31337).');
    for (const [name, address] of Object.entries(config.contracts)) {
      if ((await provider.getCode(address)) === '0x') throw new Error(`No ${name} contract at ${address}`);
    }
    for (const [policy, description] of Object.entries(POLICIES)) {
      try {
        await contracts.policiesRegistry.checkPolicy(policy, admin.address);
      } catch {
        await send(admin, (signer) => contracts.policiesRegistry.connect(signer).insertPolicy(policy, description));
      }
      // EBSI's operator offers the hash algorithms; the Support Office writes the registries.
      const holder = policy.startsWith('Timestamp:') ? admin : supportOffice;
      if (!(await contracts.policiesRegistry.checkPolicy(policy, holder.address)))
        await send(admin, (signer) =>
          contracts.policiesRegistry.connect(signer).insertUserAttributes(holder.address, [policy]),
        );
    }
    // The Timestamp API timestamps SHA-256 hashes; a new chain offers no algorithm at all.
    const {items} = await contracts.timestamp.getHashAlgorithms(1, 50);
    const names = await Promise.all(items.map(async (id) => (await contracts.timestamp.getHashAlgorithmById(id)).ianaName));
    if (!names.includes('sha-256'))
      await send(admin, (signer) =>
        contracts.timestamp.connect(signer).insertHashAlgorithm(256, 'sha-256', '2.16.840.1.101.3.4.2.1', 1, 'sha2-256'),
      );
    await fund(supportOffice.address);
    const did = config.supportOffice.did;
    if (!(await didDocument(did))) {
      const jwk = secp256k1Jwk(supportOffice.signingKey.publicKey);
      const {publicKey} = registryKey(jwk);
      const now = (await provider.getBlock('latest')).timestamp;
      await send(supportOffice, (signer) =>
        contracts.didRegistry
          .connect(signer)
          .insertDidDocument(did, JSON.stringify({'@context': ['https://www.w3.org/ns/did/v1']}), thumbprint(jwk), publicKey, true, now - 60, now + 100 * 365 * 86400),
      );
    }
    // The supervisory authority's DID, controlled by its development key: the
    // governance contract accepts a role-C signature from any valid key of it.
    if (supervisor && !(await didDocument(config.supervisor.did))) {
      await fund(supervisor.address);
      const jwk = secp256k1Jwk(supervisor.signingKey.publicKey);
      const {publicKey} = registryKey(jwk);
      const now = (await provider.getBlock('latest')).timestamp;
      await send(supervisor, (signer) =>
        contracts.didRegistry
          .connect(signer)
          .insertDidDocument(
            config.supervisor.did,
            JSON.stringify({'@context': ['https://www.w3.org/ns/did/v1']}),
            thumbprint(jwk),
            publicKey,
            true,
            now - 60,
            now + 100 * 365 * 86400,
          ),
      );
    }
    const assertion = thumbprint(supportOfficeKeys.publicJwk);
    const document = await didDocument(did);
    if (!(document.assertionMethod ?? []).includes(`${did}#${assertion}`)) {
      const now = (await provider.getBlock('latest')).timestamp;
      if (!document.verificationMethod.some((method) => method.id === `${did}#${assertion}`)) {
        const {publicKey, isSecp256k1} = registryKey(supportOfficeKeys.publicJwk);
        await send(supportOffice, (signer) =>
          contracts.didRegistry.connect(signer).addVerificationMethod(did, assertion, publicKey, isSecp256k1),
        );
      }
      await send(supportOffice, (signer) =>
        contracts.didRegistry
          .connect(signer)
          .addVerificationRelationship(did, 'assertionMethod', assertion, now - 60, now + 100 * 365 * 86400),
      );
    }
  }

  return {provider, admin, supportOffice, contracts, send, didDocument, keyOf, issuerAttributes, attribute, fund, ensureGenesis};
}
