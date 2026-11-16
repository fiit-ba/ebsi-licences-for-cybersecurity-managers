#!/usr/bin/env node
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Smoke test for the development Core API v1, acting as an EBSI client would:
 *
 *  * register a new DID with a `did-registry:invite` token (OpenID4VP 1.0,
 *    DCQL, a VerifiableAuthorisationToOnboard from the Support Office);
 *  * add an assertion key under a `did-registry:write` token (SelfAttestation);
 *  * become a RootTAO and store its authorisation (`issuers-registry:invite`);
 *  * read all of it back through the REST API;
 *  * be refused without a token, with the wrong scope, and with a draft 14
 *    compact vp_token.
 *
 * Everything it writes stays on the ledger under a fresh random DID; it
 * changes nothing a running installation depends on.
 *
 * Usage: node scripts/smoke.js [baseUrl]
 */

import crypto from 'node:crypto';
import {Interface, Wallet, hexlify, toUtf8Bytes} from 'ethers';
import {DID_REGISTRY_ABI, ISSUERS_REGISTRY_ABI} from '../src/abis.js';
import {secp256k1Jwk, registryKey, thumbprint, derivedP256} from '../src/keys.js';
import {signJwt} from '../src/jwt.js';

const BASE = (process.argv[2] ?? process.env.MOCK_BASE_URL ?? 'http://localhost:8090').replace(/\/+$/, '');
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

async function get(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {headers});
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {status: response.status, body, type: response.headers.get('content-type')};
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
  return {status: response.status, body: await response.json().catch(() => undefined)};
}

async function rpc(method, params, token) {
  const {body} = await post('/v1/ledger', {jsonrpc: '2.0', id: 1, method, params}, token ? {authorization: `Bearer ${token}`} : {});
  return body;
}

/** A new did:ebsi for a legal entity: version byte 1 and 16 random bytes, base58btc. */
function newDid() {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + Buffer.concat([Buffer.from([1]), crypto.randomBytes(16)]).toString('hex'));
  let text = '';
  while (value) {
    text = alphabet[Number(value % 58n)] + text;
    value /= 58n;
  }
  return `did:ebsi:z${text}`;
}

/** An ES256K key object for a wallet. */
function keyObject(wallet) {
  const jwk = secp256k1Jwk(wallet.signingKey.publicKey);
  const d = Buffer.from(wallet.privateKey.slice(2), 'hex').toString('base64url');
  return {jwk, privateKey: crypto.createPrivateKey({key: {...jwk, d}, format: 'jwk'})};
}

/** A presentation for the Authorisation API. */
function presentation({holder, kid, jwk, privateKey, credential}) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {alg: 'ES256K', typ: 'JWT', kid, ...(jwk ? {jwk} : {})},
    {
      iss: holder,
      sub: holder,
      aud: `${BASE}/v1/auth`,
      nonce: crypto.randomUUID(),
      iat: now,
      exp: now + 120,
      vp: {'@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiablePresentation'], holder, verifiableCredential: [credential]},
    },
    privateKey,
  );
}

/** A SelfAttestation, signed with the holder's capabilityInvocation key. */
function selfAttestation(holder, kid, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const iso = new Date(now * 1000).toISOString();
  const id = `urn:uuid:${crypto.randomUUID()}`;
  return signJwt(
    {alg: 'ES256K', typ: 'JWT', kid},
    {
      iss: holder,
      sub: holder,
      jti: id,
      iat: now,
      nbf: now,
      exp: now + 300,
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id,
        type: ['VerifiableCredential', 'VerifiableAttestation', 'SelfAttestation'],
        issuer: holder,
        issuanceDate: iso,
        issued: iso,
        validFrom: iso,
        credentialSubject: {id: holder},
        credentialSchema: {id: `${BASE}/v1/schemas-registry/schemas/zSelfAttestation`, type: 'FullJsonSchemaValidator2021'},
      },
    },
    privateKey,
  );
}

async function token(scope, vp, queryId) {
  const response = await fetch(`${BASE}/v1/auth/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'vp_token', scope: `openid ${scope}`, vp_token: JSON.stringify({[queryId]: [vp]})}),
  });
  return {status: response.status, body: await response.json()};
}

/** Sign a registry call and send it through the Ledger API, then wait for it. */
async function transact(wallet, to, data, accessToken) {
  const chainId = BigInt((await rpc('eth_chainId', [])).result);
  const nonce = BigInt((await rpc('eth_getTransactionCount', [wallet.address, 'pending'])).result);
  // A call that would revert has no estimate; send it anyway, so a refusal is the API's.
  const estimate = await rpc('eth_estimateGas', [{from: wallet.address, to, data}]);
  const gas = estimate.result ? BigInt(estimate.result) : 5_000_000n;
  const block = (await rpc('eth_getBlockByNumber', ['latest', false])).result;
  const base = BigInt(block.baseFeePerGas ?? 0);
  const raw = await wallet.signTransaction({type: 2, chainId, nonce, to, data, gasLimit: (gas * 12n) / 10n, maxFeePerGas: base * 2n + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, value: 0n});
  const sent = await rpc('eth_sendRawTransaction', [raw], accessToken);
  if (sent.error) return sent;
  for (let i = 0; i < 120; i++) {
    const receipt = (await rpc('eth_getTransactionReceipt', [sent.result])).result;
    if (receipt) return {result: sent.result, receipt};
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {error: {message: 'not mined'}};
}

console.log(`Smoke test against ${BASE}`);

for (let i = 0; i < 60; i++) {
  const health = await get('/health').catch(() => ({status: 0}));
  if (health.status === 200) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const details = await get('/v1/did-registry/details');
check('the DID Registry names its contract', /^0x[0-9a-fA-F]{40}$/.test(details.body?.contractAddress ?? ''));
const tir = (await get('/v1/issuers-registry/details')).body?.contractAddress;
const didr = details.body.contractAddress;

const support = await get('/v1/did-registry/identifiers/did:ebsi:zSupport');
check('the Support Office DID resolves with an assertion key', support.status === 200 && support.body.assertionMethod?.length === 1, JSON.stringify(support.body));
check('the DID document is JSON-LD by default', support.type?.startsWith('application/did+ld+json'));
const plain = await get('/v1/did-registry/identifiers/did:ebsi:zSupport', {accept: 'application/did+json'});
check('application/did+json drops @context', plain.status === 200 && !('@context' in plain.body));

const queries = await get(`/v1/auth/dcql-queries?scope=${encodeURIComponent('openid did-registry:invite')}`);
check('the invite scope asks for VerifiableAuthorisationToOnboard', queries.body?.dcql_query?.credentials?.[0]?.meta?.type_values?.[0]?.[0] === 'VerifiableAuthorisationToOnboard');
check('presentation_definition is gone', !('presentation_definition' in (queries.body ?? {})));

const wallet = Wallet.createRandom();
const did = newDid();
const {jwk, privateKey} = keyObject(wallet);
const vMethodId = thumbprint(jwk);
const kid = `${did}#${vMethodId}`;
check('a development key is funded', (await post('/__mock/fund', {address: wallet.address})).status === 200);

const onboarding = (await post('/__mock/support-office/onboard', {did})).body.credential;
const invite = await token('did-registry:invite', presentation({holder: did, kid, jwk, privateKey, credential: onboarding}), 'did_registry_invite_credential');
check('an invite token is granted for the onboarding authorisation', invite.status === 200 && invite.body.token_type === 'Bearer', JSON.stringify(invite.body));

const draft14 = await fetch(`${BASE}/v1/auth/token`, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'vp_token', scope: 'openid did-registry:invite', vp_token: presentation({holder: did, kid, jwk, privateKey, credential: onboarding})})});
check('a compact-JWS vp_token (draft 14) is refused', draft14.status === 400 && (await draft14.json()).error === 'invalid_request');

const didRegistry = new Interface(DID_REGISTRY_ABI);
const now = Math.floor(Date.now() / 1000);
const insert = didRegistry.encodeFunctionData('insertDidDocument', [did, JSON.stringify({'@context': ['https://www.w3.org/ns/did/v1']}), vMethodId, registryKey(jwk).publicKey, true, now - 60, now + 365 * 86400]);
const unauthorised = await rpc('eth_sendRawTransaction', [await wallet.signTransaction({type: 2, chainId: 1n, nonce: 0, to: didr, data: insert, gasLimit: 10_000_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n})]);
check('a write without a token is JSON-RPC -32600', unauthorised.error?.code === -32600, JSON.stringify(unauthorised));
const inserted = await transact(wallet, didr, insert, invite.body.access_token);
check('the DID is registered through /v1/ledger', inserted.receipt?.status === '0x1', JSON.stringify(inserted.error ?? inserted.receipt?.status));

const document = await get(`/v1/did-registry/identifiers/${did}`);
check('it resolves with its key for capabilityInvocation', document.body?.capabilityInvocation?.[0] === kid, JSON.stringify(document.body));

const write = await token('did-registry:write', presentation({holder: did, kid, privateKey, credential: selfAttestation(did, kid, privateKey)}), 'self_attestation_credential');
check('a write token is granted for a self-attestation', write.status === 200, JSON.stringify(write.body));
const assertion = derivedP256(crypto.randomUUID(), 'smoke');
const assertionId = thumbprint(assertion.publicJwk);
const {publicKey: assertionBytes} = registryKey(assertion.publicJwk);
const wrongId = await transact(wallet, didr, didRegistry.encodeFunctionData('addVerificationMethod', [did, 'key-2', assertionBytes, false]), write.body.access_token);
check('a vMethodId other than the thumbprint is refused', wrongId.error?.code === -32600, JSON.stringify(wrongId));
const added = await transact(wallet, didr, didRegistry.encodeFunctionData('addVerificationMethod', [did, assertionId, assertionBytes, false]), write.body.access_token);
const related = await transact(wallet, didr, didRegistry.encodeFunctionData('addVerificationRelationship', [did, 'assertionMethod', assertionId, now - 60, now + 365 * 86400]), write.body.access_token);
check('an assertion key is added', added.receipt?.status === '0x1' && related.receipt?.status === '0x1');
const withKey = await get(`/v1/did-registry/identifiers/${did}`);
check('the document shows it for assertionMethod', withKey.body?.assertionMethod?.includes(`${did}#${assertionId}`));
const before = await get(`/v1/did-registry/identifiers/${did}?valid-at=${new Date((now - 3600) * 1000).toISOString()}`);
check('valid-at before the keys shows none of them', before.status === 200 && !before.body.assertionMethod);

const issuers = new Interface(ISSUERS_REGISTRY_ABI);
const wrongScope = await transact(wallet, tir, issuers.encodeFunctionData('setAttributeData', [did, '0x' + '11'.repeat(32), '0x']), write.body.access_token);
check('a DID Registry token cannot write the TIR', wrongScope.error?.code === -32600, JSON.stringify(wrongScope));

const root = (await post('/__mock/support-office/root-tao', {did})).body;
check('the Support Office accredits a RootTAO', /^0x[0-9a-f]{64}$/.test(root?.attributeId ?? ''), JSON.stringify(root));
const tirInvite = await token('issuers-registry:invite', presentation({holder: did, kid, privateKey, credential: root.credential}), 'issuers_registry_invite_credential');
check('an issuers-registry invite token is granted for it', tirInvite.status === 200, JSON.stringify(tirInvite.body));
const stored = await transact(wallet, tir, issuers.encodeFunctionData('setAttributeData', [did, root.attributeId, hexlify(toUtf8Bytes(root.credential))]), tirInvite.body.access_token);
check('the RootTAO stores its authorisation', stored.receipt?.status === '0x1', JSON.stringify(stored.error));
const issuer = await get(`/v1/issuers-registry/issuers/${did}`);
check('the issuer links its attributes', issuer.body?.hasAttributes === true && issuer.body.attributes?.endsWith('/attributes'));
const attribute = await get(`/v1/issuers-registry/issuers/${did}/attributes/${root.attributeId}`);
check('the attribute is a RootTAO holding the authorisation', attribute.body?.attribute?.issuerType === 'RootTAO' && attribute.body.attribute.body === root.credential, JSON.stringify(attribute.body));

const schemaId = `zSmoke${crypto.randomBytes(4).toString('hex')}`;
await post('/__mock/support-office/schemas', {schemaId, schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object'}});
const schema = await get(`/v1/schemas-registry/schemas/${schemaId}`);
check('a schema the Support Office registered resolves', schema.status === 200 && schema.body.type === 'object');

const invoke = (await post('/__mock/support-office/invoke', {did})).body.credential;
const invokeToken = await token('ledger:invoke', presentation({holder: did, kid, privateKey, credential: invoke}), 'ledger_invoke_credential');
check('a ledger:invoke token is granted for the contract access', invokeToken.status === 200, JSON.stringify(invokeToken.body));

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
