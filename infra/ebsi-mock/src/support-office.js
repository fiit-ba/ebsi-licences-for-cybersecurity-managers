// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * What EBSI's Support Office does outside the API, on a development chain.
 *
 * On EBSI these are people and processes: the Support Office onboards a
 * RootTAO (a VerifiableAuthorisationToOnboard, then its accreditation in the
 * Trusted Issuers Registry and a VerifiableAuthorisationForTrustChain),
 * registers schemas on a submitted proposal, and grants access to a deployed
 * contract (a VerifiableAuthorisationToInvoke). Here each is one request, under
 * /__mock/, so a development installation can go through the same Core API v1
 * steps that follow them. None of it exists on EBSI's API.
 */

import crypto from 'node:crypto';
import express from 'express';
import {AbiCoder, getAddress, hexlify, isAddress, isError, sha256, toUtf8Bytes, toUtf8String} from 'ethers';
import {derivedP256, thumbprint} from './keys.js';
import {signJwt} from './jwt.js';

const ROOT_TAO = 1;
const FIVE_YEARS = 5 * 365 * 24 * 3600;

/** The DID syntax this service accepts for a subject. */
const DID = /^did:(ebsi|key):z[1-9A-HJ-NP-Za-km-z]{1,400}$/;

const iso = (seconds) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The Support Office: its DID, its assertion key, and the credentials it issues.
 * @param {object} config From readConfig.
 * @param {object} chain From connectChain.
 * @returns {object} Its keys, credential issuance and router.
 */
export function supportOffice(config, chain) {
  const did = config.supportOffice.did;
  // The assertion key, P-256 as EBSI's credentials are signed, derived from
  // the Support Office's ledger key so it is the same after every restart.
  const assertion = derivedP256(config.supportOffice.key, 'support-office-assertion');
  const kid = `${did}#${thumbprint(assertion.publicJwk)}`;

  /**
   * A Verifiable Attestation from the Support Office.
   * @param {string} type The credential's type, after VerifiableCredential and VerifiableAttestation.
   * @param {string} subject The subject's DID.
   * @param {object} [claims] More of the credential subject.
   * @returns {string} The JWT.
   */
  function issue(type, subject, claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    const id = `urn:uuid:${crypto.randomUUID()}`;
    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id,
      type: ['VerifiableCredential', 'VerifiableAttestation', type],
      issuer: did,
      issuanceDate: iso(now),
      issued: iso(now),
      validFrom: iso(now),
      expirationDate: iso(now + FIVE_YEARS),
      credentialSubject: {id: subject, ...claims},
      credentialSchema: {
        id: `${config.base}/v1/schemas-registry/schemas/zPlrAccreditationV1`,
        type: 'FullJsonSchemaValidator2021',
      },
    };
    return signJwt(
      {alg: 'ES256', typ: 'JWT', kid},
      {iss: did, sub: subject, jti: id, iat: now, nbf: now, exp: now + FIVE_YEARS, vc},
      assertion.privateKey,
    );
  }

  /**
   * The attribute the Support Office gives a RootTAO, the same for the same DID.
   * @param {string} subject The RootTAO's DID.
   * @returns {{salt: string, attributeId: string}} The salt it creates it with and the id that results.
   */
  function rootAttribute(subject) {
    const salt = sha256(toUtf8Bytes(`plr-ebsi-mock:root-tao:${subject}`));
    // IssuersRegistry._deriveRevisionId(did, salt, 0, "") for a first revision.
    const attributeId = sha256(AbiCoder.defaultAbiCoder().encode(['string', 'bytes32', 'uint256', 'bytes'], [subject, salt, 0, '0x']));
    return {salt, attributeId};
  }

  const router = express.Router();
  const subjectOf = (req, res) => {
    const subject = req.body?.did;
    if (typeof subject !== 'string' || !DID.test(subject)) {
      res.status(400).json({title: 'Bad Request', detail: 'Name the subject DID (did:ebsi or did:key).'});
      return undefined;
    }
    return subject;
  };

  // Gas for a development key; EBSI itself charges none.
  router.post('/__mock/fund', async (req, res, next) => {
    try {
      const address = req.body?.address;
      if (!isAddress(address)) return res.status(400).json({title: 'Bad Request', detail: 'Name the address to fund.'});
      const funded = await chain.fund(getAddress(address));
      return res.json({address: getAddress(address), funded});
    } catch (error) {
      next(error);
    }
  });

  // Onboarding: the authorisation a legal entity presents to register its DID.
  router.post('/__mock/support-office/onboard', (req, res) => {
    const subject = subjectOf(req, res);
    if (!subject) return;
    return res.json({credential: issue('VerifiableAuthorisationToOnboard', subject)});
  });

  // A RootTAO's accreditation: its attribute in the TIR, made by the Support
  // Office, and the authorisation it then stores there itself.
  router.post('/__mock/support-office/root-tao', async (req, res, next) => {
    try {
      const subject = subjectOf(req, res);
      if (!subject) return;
      const {salt, attributeId} = rootAttribute(subject);
      if (!(await chain.attribute(subject, attributeId))) {
        await chain.send(chain.supportOffice, (signer) =>
          chain.contracts.issuersRegistry.connect(signer).setAttributeMetadata(subject, salt, ROOT_TAO, subject, '0x' + '00'.repeat(32)),
        );
      }
      return res.json({
        attributeId,
        credential: issue('VerifiableAuthorisationForTrustChain', subject, {reservedAttributeId: attributeId}),
      });
    } catch (error) {
      next(error);
    }
  });

  // Access to the Trusted Contracts: what a `ledger:invoke` token is granted on.
  router.post('/__mock/support-office/invoke', (req, res) => {
    const subject = subjectOf(req, res);
    if (!subject) return;
    return res.json({credential: issue('VerifiableAuthorisationToInvoke', subject, {contracts: config.invoke})});
  });

  // Schema registration: on EBSI the Support Office registers a schema on a
  // submitted proposal (component 7); here it is registered at once. A schema
  // already registered with other content gets a new revision.
  router.post('/__mock/support-office/schemas', async (req, res, next) => {
    try {
      const {schemaId, schema} = req.body ?? {};
      if (typeof schemaId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(schemaId) || !schema || typeof schema !== 'object')
        return res.status(400).json({title: 'Bad Request', detail: 'Name the schema id and give the schema.'});
      const id = hexlify(toUtf8Bytes(schemaId));
      const content = JSON.stringify(schema);
      let current;
      try {
        current = toUtf8String(await chain.contracts.schemasRegistry.getLatestSchemaRevision(id));
      } catch (error) {
        if (!isError(error, 'CALL_EXCEPTION')) throw error;
      }
      if (current !== content) {
        const metadata = hexlify(toUtf8Bytes(JSON.stringify({registeredBy: did})));
        await chain.send(chain.supportOffice, (signer) => {
          const registry = chain.contracts.schemasRegistry.connect(signer);
          return current === undefined
            ? registry.insertSchema(id, hexlify(toUtf8Bytes(content)), metadata)
            : registry.updateSchema(id, hexlify(toUtf8Bytes(content)), metadata);
        });
      }
      return res.json({schemaId, href: `${config.base}/v1/schemas-registry/schemas/${schemaId}`, registered: current !== content});
    } catch (error) {
      next(error);
    }
  });

  return {did, assertion, kid, issue, router};
}
