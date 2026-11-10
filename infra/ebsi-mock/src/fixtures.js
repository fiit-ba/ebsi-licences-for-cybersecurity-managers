// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Test fixtures, for the back-office's own tests: a whole trust chain in one
 * request, keys published into a DID document, accreditations revoked. They
 * write to EBSI's contracts on the development ledger as the parties would -
 * every DID they create is controlled by a key this service derives for it,
 * every accreditation is a JWT signed by the accreditor's derived P-256 key
 * and stored by the accredited DID itself - so what tests read back through
 * /v1 is what a verifier reads. None of this exists on EBSI's API.
 *
 *   POST /__mock/seed      {rootTao?, tao?, trustedIssuer?, schemas?, accreditedFor?}
 *   POST /__mock/did-keys  {did, keys: [{kid, publicKeyJwk, purposes?, activatedAt?, retiredAt?}]}
 *   POST /__mock/revoke    {did}
 */

import crypto from 'node:crypto';
import express from 'express';
import {AbiCoder, Wallet, concat, hexlify, keccak256, sha256, toUtf8Bytes} from 'ethers';
import {derivedP256, registryKey, secp256k1Jwk, thumbprint} from './keys.js';
import {signJwt} from './jwt.js';

const ISSUER_TYPE = {RootTAO: 1, TAO: 2, TI: 3, Revoked: 4};
const FIVE_YEARS = 5 * 365 * 24 * 3600;
const CENTURY = 100 * 365 * 24 * 3600;
const DID = /^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/;
const iso = (seconds) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The fixture routes.
 * @param {object} config From readConfig.
 * @param {object} chain From connectChain.
 * @param {object} office From supportOffice.
 * @returns {import('express').Router} The router.
 */
export function fixturesRouter(config, chain, office) {
  const abi = AbiCoder.defaultAbiCoder();

  /** The key this service controls a DID it created with, the same after every restart. */
  const controllerOf = (did) => new Wallet(keccak256(concat([config.adminKey, toUtf8Bytes(`plr-ebsi-mock:controller:${did}`)])), chain.provider);
  /** The P-256 key a DID this service created signs accreditations with. */
  const assertionOf = (did) => {
    const key = derivedP256(config.adminKey, `assertion:${did}`);
    return {...key, vMethodId: thumbprint(key.publicJwk), kid: `${did}#${thumbprint(key.publicJwk)}`};
  };

  /**
   * When fixture keys and accreditations start to hold: now, by the earlier of the chain's clock
   * and the wall clock. Tests move a test ledger's clock forward; credentials are still signed at
   * wall-clock time and must find their issuer's keys and accreditation already valid.
   * @returns {Promise<number>} Seconds since the epoch.
   */
  async function validFrom() {
    const chainNow = (await chain.provider.getBlock('latest')).timestamp;
    return Math.min(chainNow, Math.floor(Date.now() / 1000));
  }

  /**
   * Make sure a DID exists, controlled by its derived key, with its derived assertion key.
   * @param {string} did The DID.
   * @param {boolean} [assertion] Whether to publish the assertion key as well.
   * @returns {Promise<Wallet>} The controller.
   */
  async function ensureDid(did, assertion = true) {
    const controller = controllerOf(did);
    await chain.fund(controller.address);
    const now = await validFrom();
    let document = await chain.didDocument(did);
    if (!document) {
      const jwk = secp256k1Jwk(controller.signingKey.publicKey);
      await chain.send(controller, (signer) =>
        chain.contracts.didRegistry
          .connect(signer)
          .insertDidDocument(did, JSON.stringify({'@context': ['https://www.w3.org/ns/did/v1']}), thumbprint(jwk), registryKey(jwk).publicKey, true, now - 60, now + CENTURY),
      );
      document = await chain.didDocument(did);
    }
    if (assertion) {
      const key = assertionOf(did);
      await publish(did, [{kid: key.kid, publicKeyJwk: key.publicJwk, purposes: ['assertionMethod']}], document);
    }
    return controller;
  }

  /**
   * Publish keys into a DID this service controls, each with its relationships and window.
   * @param {string} did The DID.
   * @param {object[]} keys `{kid, publicKeyJwk, purposes?, activatedAt?, retiredAt?}`.
   * @param {object} [known] The document as just read.
   * @returns {Promise<number>} How many verification methods the document has then.
   */
  async function publish(did, keys, known) {
    const controller = controllerOf(did);
    const document = known ?? (await chain.didDocument(did));
    if (!document) throw Object.assign(new Error(`${did} is not in the DID Registry`), {status: 404});
    const now = await validFrom();
    const seconds = (value, fallback) => (value ? Math.floor(Date.parse(value) / 1000) : fallback);
    const methods = new Set((document.verificationMethod ?? []).map((method) => method.id));
    const holding = (name) => new Set((document[name] ?? []).map((ref) => (typeof ref === 'string' ? ref : ref?.id)));
    for (const {kid, publicKeyJwk, purposes, activatedAt, retiredAt} of keys) {
      if (typeof kid !== 'string' || !publicKeyJwk) continue;
      const id = kid.startsWith(did) ? kid : `${did}#${kid.replace(/^#/, '')}`;
      const vMethodId = id.slice(did.length + 1);
      const {publicKey, isSecp256k1} = registryKey(publicKeyJwk);
      if (!methods.has(id)) {
        await chain.send(controller, (signer) => chain.contracts.didRegistry.connect(signer).addVerificationMethod(did, vMethodId, publicKey, isSecp256k1));
        methods.add(id);
      }
      const from = seconds(activatedAt, now - 60);
      const until = seconds(retiredAt, now + CENTURY);
      for (const name of purposes ?? ['authentication', 'assertionMethod']) {
        if (holding(name).has(id) && !activatedAt && !retiredAt) continue;
        await chain.send(controller, (signer) => chain.contracts.didRegistry.connect(signer).addVerificationRelationship(did, name, vMethodId, from, until));
      }
    }
    return methods.size;
  }

  /**
   * An accreditation, signed by the accreditor's derived key.
   * @param {object} fields Issuer, subject, types, scope and terms of use.
   * @returns {string} The JWT.
   */
  function accreditation({issuer, subject, types, accreditedFor, termsOfUse}) {
    const signer = issuer === office.did ? {kid: office.kid, privateKey: office.assertion.privateKey} : assertionOf(issuer);
    const now = Math.floor(Date.now() / 1000);
    const id = `urn:uuid:${crypto.randomUUID()}`;
    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id,
      type: ['VerifiableCredential', 'VerifiableAttestation', ...types],
      issuer,
      issuanceDate: iso(now),
      validFrom: iso(now),
      issued: iso(now),
      validUntil: iso(now + FIVE_YEARS),
      credentialSubject: {id: subject, ...(accreditedFor ? {accreditedFor} : {})},
      ...(termsOfUse ? {termsOfUse} : {}),
      credentialSchema: {id: `${config.base}/v1/schemas-registry/schemas/zPlrAccreditationV1`, type: 'FullJsonSchemaValidator2021'},
    };
    return signJwt({alg: 'ES256', typ: 'JWT', kid: signer.kid}, {iss: issuer, sub: subject, jti: id, iat: now, nbf: now, exp: now + FIVE_YEARS, vc}, signer.privateKey);
  }

  /** The salt an accreditation of `did` by `accreditor` is created with, and its attribute id. */
  const attributeOf = (did, accreditor) => {
    const salt = sha256(toUtf8Bytes(`plr-ebsi-mock:attribute:${did}|${accreditor}`));
    return {salt, attributeId: sha256(abi.encode(['string', 'bytes32', 'uint256', 'bytes'], [did, salt, 0, '0x']))};
  };

  /**
   * Accredit `did` as `type`, by `accreditor` (the Support Office for a RootTAO), and store the
   * accreditation as the accredited DID.
   * @returns {Promise<string>} The attribute id.
   */
  async function accredit({did, type, accreditor, accreditorAttribute, body}) {
    const controller = await ensureDid(did, type !== 'TI');
    const {salt, attributeId} = attributeOf(did, accreditor);
    if (!(await chain.attribute(did, attributeId))) {
      const writer = type === 'RootTAO' ? chain.supportOffice : controllerOf(accreditor);
      await chain.fund(writer.address);
      await chain.send(writer, (signer) =>
        chain.contracts.issuersRegistry
          .connect(signer)
          .setAttributeMetadata(did, salt, ISSUER_TYPE[type], type === 'RootTAO' ? did : accreditor, accreditorAttribute ?? '0x' + '00'.repeat(32)),
      );
      await chain.send(controller, (signer) => chain.contracts.issuersRegistry.connect(signer).setAttributeData(did, attributeId, hexlify(toUtf8Bytes(body))));
    }
    return attributeId;
  }

  const router = express.Router();
  router.use('/__mock', express.json({limit: '2mb'}));
  const attributeUrl = (did, id) => `${config.base}/v1/issuers-registry/issuers/${did}/attributes/${id}`;

  router.post('/__mock/seed', async (req, res, next) => {
    try {
      const {rootTao, tao, trustedIssuer, schemas = {}, accreditedFor = []} = req.body ?? {};
      for (const did of [rootTao, tao, trustedIssuer]) if (did !== undefined && !DID.test(did)) return res.status(400).json({title: 'Bad Request', detail: `Not a did:ebsi: ${did}`});
      const scope = accreditedFor.map(({schemaId, types}) => ({schemaId, types, limitJurisdiction: 'https://publications.europa.eu/resource/authority/atu/SVK'}));
      const attributes = {};
      if (rootTao)
        attributes.rootTao = await accredit({
          did: rootTao,
          type: 'RootTAO',
          accreditor: office.did,
          body: office.issue('VerifiableAuthorisationForTrustChain', rootTao, {reservedAttributeId: attributeOf(rootTao, office.did).attributeId}),
        });
      if (tao)
        attributes.tao = await accredit({
          did: tao,
          type: 'TAO',
          accreditor: rootTao,
          accreditorAttribute: attributes.rootTao,
          body: accreditation({
            issuer: rootTao,
            subject: tao,
            types: ['VerifiableAccreditationToAccredit'],
            accreditedFor: scope,
            termsOfUse: attributes.rootTao && {id: attributeUrl(rootTao, attributes.rootTao), type: 'IssuanceCertificate'},
          }),
        });
      if (trustedIssuer)
        attributes.trustedIssuer = await accredit({
          did: trustedIssuer,
          type: 'TI',
          accreditor: tao,
          accreditorAttribute: attributes.tao,
          body: accreditation({
            issuer: tao,
            subject: trustedIssuer,
            types: ['VerifiableAccreditationToAttest'],
            accreditedFor: scope,
            termsOfUse: attributes.tao && {id: attributeUrl(tao, attributes.tao), type: 'IssuanceCertificate'},
          }),
        });
      for (const [schemaId, schema] of Object.entries(schemas)) {
        const id = hexlify(toUtf8Bytes(schemaId));
        const metadata = hexlify(toUtf8Bytes(JSON.stringify({registeredBy: office.did})));
        let exists = true;
        try {
          await chain.contracts.schemasRegistry.getLatestSchemaRevision(id);
        } catch {
          exists = false;
        }
        await chain.send(chain.supportOffice, (signer) => {
          const registry = chain.contracts.schemasRegistry.connect(signer);
          const content = hexlify(toUtf8Bytes(JSON.stringify(schema)));
          return exists ? registry.updateSchema(id, content, metadata) : registry.insertSchema(id, content, metadata);
        });
      }
      return res.status(201).json({seeded: true, supportOffice: office.did, attributes});
    } catch (error) {
      next(error);
    }
  });

  router.post('/__mock/did-keys', async (req, res, next) => {
    try {
      const {did, keys = []} = req.body ?? {};
      if (!DID.test(did ?? '') || !Array.isArray(keys) || !keys.length) return res.status(400).json({title: 'Bad Request', detail: 'did and keys are required'});
      await ensureDid(did, false);
      return res.status(201).json({id: did, verificationMethod: await publish(did, keys)});
    } catch (error) {
      if (error?.status === 404) return res.status(404).json({title: 'Not Found', detail: error.message});
      next(error);
    }
  });

  // Revoke a DID's accreditations: each attribute's latest revision becomes Revoked, written
  // by its accreditor, as a TAO revokes a TI on EBSI.
  router.post('/__mock/revoke', async (req, res, next) => {
    try {
      const {did} = req.body ?? {};
      if (!DID.test(did ?? '')) return res.status(400).json({title: 'Bad Request', detail: 'did is required'});
      const ids = (await chain.issuerAttributes(did)) ?? [];
      let revoked = 0;
      for (const id of ids) {
        const attribute = await chain.attribute(did, id);
        if (!attribute || Number(attribute.issuerType) === ISSUER_TYPE.Revoked) continue;
        const accreditor = attribute.tao === did ? undefined : attribute.tao;
        const writer = accreditor ? controllerOf(accreditor) : chain.supportOffice;
        await chain.send(writer, (signer) => chain.contracts.issuersRegistry.connect(signer).setAttributeMetadata(did, id, ISSUER_TYPE.Revoked, accreditor ?? did, attribute.parentAttributeId ?? '0x' + '00'.repeat(32)));
        revoked++;
      }
      return res.json({did, revoked});
    } catch (error) {
      next(error);
    }
  });

  return router;
}
