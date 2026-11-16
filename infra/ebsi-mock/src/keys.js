// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Public keys as the DID Registry keeps them and as JOSE names them.
 *
 * The registry stores a secp256k1 key as its 65 (or 64) raw bytes, which is
 * what its controller checks derive an address from, and any other key as the
 * UTF-8 bytes of its JWK - EBSI's own convention. A verification method's id is
 * the key's RFC 7638 thumbprint, which Core API v1 requires.
 */

import crypto from 'node:crypto';
import {SigningKey, getBytes, hexlify, toUtf8Bytes, toUtf8String} from 'ethers';

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');

/**
 * A secp256k1 public key as a JWK.
 * @param {string|Uint8Array} publicKey 0x04|X|Y, X|Y, or a compressed key.
 * @returns {{kty: string, crv: string, x: string, y: string}} The JWK.
 */
export function secp256k1Jwk(publicKey) {
  let bytes = getBytes(publicKey);
  if (bytes.length === 64) bytes = Uint8Array.from([4, ...bytes]);
  const uncompressed = getBytes(SigningKey.computePublicKey(bytes, false));
  return {kty: 'EC', crv: 'secp256k1', x: base64url(uncompressed.slice(1, 33)), y: base64url(uncompressed.slice(33, 65))};
}

/**
 * The bytes the DID Registry keeps for a public JWK.
 * @param {object} jwk Public JWK (EC P-256 or secp256k1).
 * @returns {{publicKey: string, isSecp256k1: boolean}} Hex bytes and the registry's flag.
 */
export function registryKey(jwk) {
  if (jwk.crv === 'secp256k1') {
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    return {publicKey: hexlify(Buffer.concat([Buffer.from([4]), x, y])), isSecp256k1: true};
  }
  const {kty, crv, x, y} = jwk;
  return {publicKey: hexlify(toUtf8Bytes(JSON.stringify({kty, crv, x, y}))), isSecp256k1: false};
}

/**
 * The JWK a registry verification method holds.
 * @param {{publicKey: string, isSecp256k1: boolean}} method Registry verification method.
 * @returns {object|undefined} Its public JWK, or nothing when the bytes are not a key.
 */
export function methodJwk(method) {
  try {
    if (method.isSecp256k1) return secp256k1Jwk(method.publicKey);
    const jwk = JSON.parse(toUtf8String(method.publicKey));
    if (!jwk || jwk.kty !== 'EC' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return undefined;
    return {kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y};
  } catch {
    return undefined;
  }
}

/**
 * The RFC 7638 thumbprint of a public EC JWK.
 * @param {{crv: string, kty: string, x: string, y: string}} jwk Public key.
 * @returns {string} base64url SHA-256 of the canonical members.
 */
export function thumbprint({crv, kty, x, y}) {
  return crypto.createHash('sha256').update(JSON.stringify({crv, kty, x, y})).digest('base64url');
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode base58btc.
 * @param {string} value Encoded text.
 * @returns {Buffer} The bytes.
 */
function base58Decode(value) {
  let number = 0n;
  for (const digit of value) {
    const index = BASE58.indexOf(digit);
    if (index < 0) throw new Error('Not base58');
    number = number * 58n + BigInt(index);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const leading = value.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(leading), number ? Buffer.from(hex, 'hex') : Buffer.alloc(0)]);
}

/**
 * The public key of an EBSI natural-person did:key (jwk_jcs-pub multicodec 0xeb51).
 * @param {string} did The DID.
 * @returns {object|undefined} Its JWK, or nothing for another kind of did:key.
 */
export function didKeyJwk(did) {
  if (typeof did !== 'string' || !/^did:key:z[1-9A-HJ-NP-Za-km-z]{1,400}$/.test(did)) return undefined;
  try {
    const bytes = base58Decode(did.slice('did:key:z'.length));
    if (bytes[0] !== 0xd1 || bytes[1] !== 0xd6 || bytes[2] !== 0x03) return undefined;
    const {kty, crv, x, y} = JSON.parse(bytes.subarray(3).toString('utf8'));
    if (kty !== 'EC' || !['P-256', 'secp256k1'].includes(crv)) return undefined;
    return {kty, crv, x, y};
  } catch {
    return undefined;
  }
}

/**
 * A P-256 key pair derived from a seed, so it survives restarts without storage.
 * @param {string} seed Secret seed text.
 * @param {string} purpose Domain separation for the derived key.
 * @returns {{privateKey: crypto.KeyObject, publicJwk: object}} The key pair.
 */
export function derivedP256(seed, purpose) {
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const digest = crypto.createHash('sha256').update(`plr-ebsi-mock:${purpose}:${seed}`).digest();
  const scalar = (BigInt('0x' + digest.toString('hex')) % (order - 1n)) + 1n;
  const d = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const publicJwk = {kty: 'EC', crv: 'P-256', x: base64url(point.subarray(1, 33)), y: base64url(point.subarray(33, 65))};
  const privateKey = crypto.createPrivateKey({key: {...publicJwk, d: base64url(d)}, format: 'jwk'});
  return {privateKey, publicJwk};
}

/**
 * A secp256k1 private key as a node KeyObject, for ES256K JWS.
 * @param {string} hexKey 0x-prefixed private key.
 * @returns {{privateKey: crypto.KeyObject, publicJwk: object}} The key pair.
 */
export function secp256k1KeyObject(hexKey) {
  const signing = new SigningKey(hexKey);
  const publicJwk = secp256k1Jwk(signing.publicKey);
  const d = Buffer.from(getBytes(signing.privateKey)).toString('base64url');
  const privateKey = crypto.createPrivateKey({key: {...publicJwk, d}, format: 'jwk'});
  return {privateKey, publicJwk};
}
