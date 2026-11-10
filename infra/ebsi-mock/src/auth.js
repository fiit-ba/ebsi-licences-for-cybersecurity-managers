// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * EBSI's Authorisation API, Core API v1 (hub.ebsi.eu/api/access-control):
 * OpenID4VP 1.0 with a DCQL query per scope, and a `vp_token` grant at the
 * token endpoint. The presentation draft 14 grant is gone, as on EBSI.
 *
 *   GET  /v1/auth/.well-known/openid-configuration
 *   GET  /v1/auth/dcql-queries?scope=openid <scope>
 *   POST /v1/auth/token        grant_type=vp_token, scope, vp_token={"<query id>":["<VP JWT>"]}
 *   GET  /v1/auth/jwks
 *
 * A presentation is checked against the registries on the ledger: the
 * holder's key in the DID Registry (or, to register a DID, the key it is to be
 * registered with), each credential's issuer key at its issuance, and the
 * issuer's standing in the Trusted Issuers Registry or as the Support Office.
 */

import crypto from 'node:crypto';
import express from 'express';
import {ISSUER_TYPES} from './abis.js';
import {decodeJwt, signJwt, verifiedWith} from './jwt.js';
import {derivedP256, didKeyJwk, thumbprint} from './keys.js';

const TOKEN_SECONDS = 7200;
const VP_WINDOW = 300;

/** What each scope asks for (the access-control page's "Credential query IDs"). */
const SELF_ATTESTED = ['did-registry:write', 'issuers-registry:write', 'timestamp:write', 'track-and-trace:create', 'track-and-trace:write', 'policies-registry:write', 'schemas-registry:write'];
const QUERIES = {
  'did-registry:invite': {id: 'did_registry_invite_credential', types: [['VerifiableAuthorisationToOnboard']], algs: ['ES256K'], alone: true},
  'issuers-registry:invite': {
    id: 'issuers_registry_invite_credential',
    types: [['VerifiableAuthorisationForTrustChain'], ['VerifiableAccreditationToAttest'], ['VerifiableAccreditationToAccredit']],
    algs: ['ES256', 'ES256K'],
    alone: true,
  },
  'ledger:invoke': {id: 'ledger_invoke_credential', types: [['VerifiableAuthorisationToInvoke']], algs: ['ES256', 'ES256K'], alone: true, didKey: true},
  ...Object.fromEntries(SELF_ATTESTED.map((scope) => [scope, {id: 'self_attestation_credential', types: [['SelfAttestation']], algs: ['ES256', 'ES256K'], didKey: scope === 'track-and-trace:write'}])),
};

/**
 * Parse a scope request into its scopes, without `openid` and instance suffixes.
 * @param {string} value The `scope` parameter.
 * @returns {{scopes: string[]}|{error: string}} The scopes, or why not.
 */
export function parseScopes(value) {
  const parts = String(value ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.includes('openid')) return {error: 'The scope must include openid.'};
  const scopes = [];
  for (const part of parts) {
    if (part === 'openid') continue;
    // `<registry>:<action>[:0x<address>]`: an instance target is accepted and
    // ignored, as this service answers for one instance of each registry.
    const scope = part.replace(/:0x[0-9a-fA-F]{40}$/, '');
    if (!QUERIES[scope]) return {error: `Unrecognised scope ${part}.`};
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  if (!scopes.length) return {error: 'Name a scope besides openid.'};
  if (scopes.length > 1 && scopes.some((scope) => QUERIES[scope].alone))
    return {error: 'Invite scopes and ledger:invoke must be requested alone.'};
  return {scopes};
}

/**
 * The DCQL query a set of scopes asks for: combined scopes share one credential requirement.
 * @param {string[]} scopes Parsed scopes.
 * @returns {{query: object, algs: string[]}} The query and the presentation algorithms accepted.
 */
function dcqlFor(scopes) {
  const query = QUERIES[scopes[0]];
  const algs = scopes.reduce((accepted, scope) => accepted.filter((alg) => QUERIES[scope].algs.includes(alg)), ['ES256', 'ES256K']);
  return {
    query: {
      credentials: [
        {
          id: query.id,
          format: 'jwt_vc_json',
          require_cryptographic_holder_binding: true,
          meta: {type_values: query.types},
        },
      ],
    },
    algs,
  };
}

/**
 * The Authorisation API.
 * @param {object} config From readConfig.
 * @param {object} chain From connectChain.
 * @param {object} office From supportOffice.
 * @returns {{router: import('express').Router, verifyToken: (token: string) => object|undefined}} Routes and token checks.
 */
export function authorisation(config, chain, office) {
  const issuer = `${config.base}/v1/auth`;
  const audience = `${config.base}/v1`;
  const signing = derivedP256(config.adminKey, 'authorisation-tokens');
  const signingKid = thumbprint(signing.publicJwk);
  const seenNonces = new Map();

  /** Forget nonces past every presentation's lifetime. */
  function sweepNonces(now) {
    for (const [nonce, until] of seenNonces) if (until <= now) seenNonces.delete(nonce);
  }

  /**
   * Whether a TIR issuer currently holds a live RootTAO or TAO attribute.
   * @param {string} did The issuer.
   * @returns {Promise<boolean>} True for a live accreditor.
   */
  async function isAccreditor(did) {
    const ids = await chain.issuerAttributes(did);
    for (const id of ids ?? []) {
      const attribute = await chain.attribute(did, id);
      const type = ISSUER_TYPES[Number(attribute?.issuerType)];
      if (type === 'RootTAO' || type === 'TAO') return true;
    }
    return false;
  }

  /**
   * Check one credential of a presentation.
   * @param {string} jwt The credential.
   * @param {string[][]} typeValues Acceptable type sets.
   * @param {string} holder The presenting DID.
   * @param {number} now Unix seconds.
   * @returns {Promise<string|undefined>} Why it is refused, or nothing.
   */
  async function credentialRefusal(jwt, typeValues, holder, now) {
    let decoded;
    try {
      decoded = decodeJwt(String(jwt).split('~')[0]);
    } catch {
      return 'A credential is not a JWT.';
    }
    const {header, payload} = decoded;
    const vc = payload.vc;
    if (!vc || typeof vc !== 'object') return 'A credential carries no vc claim.';
    const types = Array.isArray(vc.type) ? vc.type : [];
    if (!typeValues.some((set) => set.every((type) => types.includes(type)))) return 'A credential is not of a requested type.';
    const credentialIssuer = typeof vc.issuer === 'object' ? vc.issuer?.id : vc.issuer;
    if (payload.iss !== credentialIssuer) return 'A credential names two issuers.';
    if (vc.credentialSubject?.id !== holder || (payload.sub !== undefined && payload.sub !== holder))
      return 'A credential is not the holder’s.';
    const from = payload.nbf ?? Math.floor(Date.parse(vc.validFrom ?? vc.issuanceDate) / 1000);
    const until = payload.exp ?? Math.floor(Date.parse(vc.expirationDate ?? vc.validUntil) / 1000);
    if (!(from <= now + 5) || (Number.isFinite(until) && until <= now)) return 'A credential is not valid now.';
    if (typeof header.kid !== 'string' || !header.kid.startsWith(`${credentialIssuer}#`)) return 'A credential names no key of its issuer.';
    const issuedAt = Number.isFinite(payload.iat) ? payload.iat : from;
    if (types.includes('SelfAttestation')) {
      if (credentialIssuer !== holder) return 'A self-attestation names another issuer.';
      // Verified against capabilityInvocation, not assertionMethod.
      const key = await chain.keyOf(header.kid, ['capabilityInvocation'], issuedAt);
      return key && verifiedWith(decoded, key) ? undefined : 'The self-attestation is not signed by a capabilityInvocation key of the holder.';
    }
    const key = await chain.keyOf(header.kid, ['assertionMethod'], issuedAt);
    if (!key || !verifiedWith(decoded, key)) return 'A credential is not signed by an assertion key of its issuer.';
    const fromSupportOffice = credentialIssuer === office.did;
    if (types.includes('VerifiableAuthorisationForTrustChain') || types.includes('VerifiableAuthorisationToInvoke'))
      return fromSupportOffice ? undefined : 'Only the Support Office issues this authorisation.';
    if (fromSupportOffice || (await isAccreditor(credentialIssuer))) return undefined;
    return 'The credential’s issuer is not a RootTAO or TAO in the Trusted Issuers Registry.';
  }

  /**
   * Check the presentation for a scope request and say what the token may carry.
   * @param {string[]} scopes Parsed scopes.
   * @param {unknown} vpToken The `vp_token` parameter, a JSON object.
   * @returns {Promise<{sub: string, jkt?: string}|{error: string}>} The holder, or why not.
   */
  async function presentation(scopes, vpToken) {
    const {query, algs} = dcqlFor(scopes);
    const credentialQuery = query.credentials[0];
    let token;
    try {
      token = typeof vpToken === 'string' ? JSON.parse(vpToken) : undefined;
    } catch {
      token = undefined;
    }
    // A compact JWS vp_token was the draft 14 grant, which Core API v1 refuses.
    if (!token || typeof token !== 'object' || Array.isArray(token))
      return {error: 'vp_token must be a JSON object keyed by DCQL credential-query id.'};
    const keys = Object.keys(token);
    if (keys.length !== 1 || keys[0] !== credentialQuery.id || !Array.isArray(token[keys[0]]) || token[keys[0]].length !== 1)
      return {error: `vp_token must hold exactly one presentation under ${credentialQuery.id}.`};

    let decoded;
    try {
      decoded = decodeJwt(token[credentialQuery.id][0]);
    } catch {
      return {error: 'The presentation is not a JWT.'};
    }
    const {header, payload} = decoded;
    if (!algs.includes(header.alg)) return {error: `The presentation must be signed with ${algs.join(' or ')}.`};
    const holder = payload.iss;
    if (typeof holder !== 'string' || !/^did:(ebsi|key):/.test(holder)) return {error: 'The presentation names no holder DID.'};
    if (holder.startsWith('did:key:') && !scopes.every((scope) => QUERIES[scope].didKey))
      return {error: 'A did:key holder may ask only for ledger:invoke or track-and-trace:write.'};

    let key;
    let jkt;
    if (scopes[0] === 'did-registry:invite') {
      // The DID is not registered yet: the presentation carries the key it is
      // to be registered with, and the token binds it (cnf.jkt).
      if (!header.jwk || header.jwk.crv !== 'secp256k1') return {error: 'Registering a DID needs its secp256k1 key in the presentation header.'};
      jkt = thumbprint(header.jwk);
      if (header.kid !== `${holder}#${jkt}`) return {error: 'The presentation kid must be the DID and its key’s thumbprint.'};
      key = header.jwk;
    } else if (holder.startsWith('did:key:')) {
      key = didKeyJwk(holder);
    } else {
      if (typeof header.kid !== 'string' || !header.kid.startsWith(`${holder}#`)) return {error: 'The presentation names no key of its holder.'};
      key = await chain.keyOf(header.kid, ['authentication', 'capabilityInvocation']);
    }
    if (!key || !verifiedWith(decoded, key)) return {error: 'The presentation is not signed by a key of its holder.'};

    const now = Math.floor(Date.now() / 1000);
    sweepNonces(now);
    if (payload.aud !== issuer) return {error: `The presentation's aud must be ${issuer}.`};
    if (typeof payload.nonce !== 'string' || !payload.nonce || payload.nonce.length > 256) return {error: 'The presentation needs a nonce.'};
    if (seenNonces.has(payload.nonce)) return {error: 'The presentation was already used.'};
    if (!Number.isFinite(payload.iat) || payload.iat > now + 5 || payload.iat < now - VP_WINDOW)
      return {error: 'iat must be within the last five minutes.'};
    if (!Number.isFinite(payload.exp) || payload.exp <= now || payload.exp > now + VP_WINDOW + 5)
      return {error: 'exp must be less than five minutes ahead.'};
    const vp = payload.vp;
    if (!vp || !Array.isArray(vp.type) || !vp.type.includes('VerifiablePresentation') || (vp.holder !== undefined && vp.holder !== holder))
      return {error: 'The presentation carries no vp of its holder.'};
    const credentials = vp.verifiableCredential;
    if (!Array.isArray(credentials) || credentials.length !== 1) return {error: 'The presentation must carry exactly one credential.'};
    const refusal = await credentialRefusal(credentials[0], credentialQuery.meta.type_values, holder, now);
    if (refusal) return {error: refusal};

    seenNonces.set(payload.nonce, now + VP_WINDOW + 60);
    return {sub: holder, ...(jkt ? {jkt} : {})};
  }

  /**
   * Verify an access token this service issued.
   * @param {string} token The bearer token.
   * @returns {object|undefined} Its claims while valid, else nothing.
   */
  function verifyToken(token) {
    try {
      const decoded = decodeJwt(token);
      if (!verifiedWith(decoded, signing.publicJwk)) return undefined;
      const {payload} = decoded;
      const now = Math.floor(Date.now() / 1000);
      if (payload.iss !== issuer || payload.aud !== audience || !(payload.exp > now)) return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }

  const router = express.Router();

  router.get('/v1/auth/.well-known/openid-configuration', (_req, res) =>
    res.json({
      issuer,
      token_endpoint: `${issuer}/token`,
      dcql_query_endpoint: `${issuer}/dcql-queries`,
      jwks_uri: `${issuer}/jwks`,
      scopes_supported: ['openid', ...Object.keys(QUERIES)],
      grant_types_supported: ['vp_token'],
      response_types_supported: ['token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
      id_token_types_supported: ['attester_signed_id_token'],
      subject_syntax_types_supported: ['did:ebsi', 'did:key'],
      vp_formats_supported: {jwt_vc_json: {alg_values_supported: ['ES256', 'ES256K']}},
    }),
  );

  router.get('/v1/auth/jwks', (_req, res) => res.json({keys: [{...signing.publicJwk, kid: signingKid, alg: 'ES256', use: 'sig'}]}));

  router.get('/v1/auth/dcql-queries', (req, res) => {
    const parsed = parseScopes(req.query.scope);
    if (parsed.error) return res.status(400).json({error: 'invalid_scope', error_description: parsed.error});
    const {query, algs} = dcqlFor(parsed.scopes);
    return res.json({client_metadata: {vp_formats_supported: {jwt_vc_json: {alg_values_supported: algs}}}, dcql_query: query});
  });

  router.post('/v1/auth/token', express.urlencoded({extended: false, limit: '256kb'}), async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (body.grant_type !== 'vp_token')
        return res.status(400).json({error: 'unsupported_grant_type', error_description: 'Core API v1 accepts only grant_type=vp_token.'});
      if (body.presentation_submission !== undefined)
        return res.status(400).json({error: 'invalid_request', error_description: 'presentation_submission must be omitted.'});
      const parsed = parseScopes(body.scope);
      if (parsed.error) return res.status(400).json({error: 'invalid_scope', error_description: parsed.error});
      const result = await presentation(parsed.scopes, body.vp_token);
      if (result.error) return res.status(400).json({error: 'invalid_request', error_description: result.error});
      const now = Math.floor(Date.now() / 1000);
      const scope = ['openid', ...parsed.scopes].join(' ');
      const accessToken = signJwt(
        {alg: 'ES256', typ: 'JWT', kid: signingKid},
        {
          iss: issuer,
          aud: audience,
          sub: result.sub,
          scope,
          iat: now,
          exp: now + TOKEN_SECONDS,
          jti: crypto.randomUUID(),
          ...(result.jkt ? {cnf: {jkt: result.jkt}} : {}),
        },
        signing.privateKey,
      );
      if (!config.quiet) console.log('[ebsi-mock] token', scope, 'for', result.sub);
      return res.set('cache-control', 'no-store').json({access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_SECONDS, scope});
    } catch (error) {
      next(error);
    }
  });

  return {router, verifyToken};
}
