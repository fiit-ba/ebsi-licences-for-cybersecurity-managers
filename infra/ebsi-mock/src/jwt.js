// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Compact JWS with ES256 (P-256) and ES256K (secp256k1), the two algorithms
 * EBSI's Core API v1 accepts for presentations and credentials.
 */

import crypto from 'node:crypto';

const CURVES = {ES256: 'P-256', ES256K: 'secp256k1'};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Sign a JWT.
 * @param {object} header JOSE header; `alg` must be ES256 or ES256K.
 * @param {object} payload Claims.
 * @param {crypto.KeyObject} privateKey Key of the header's curve.
 * @returns {string} The compact JWT.
 */
export function signJwt(header, payload, privateKey) {
  if (!CURVES[header.alg]) throw new Error(`Unsupported alg ${header.alg}`);
  const input = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(input), {key: privateKey, dsaEncoding: 'ieee-p1363'});
  return `${input}.${signature.toString('base64url')}`;
}

/**
 * Decode a JWT without verifying it.
 * @param {string} token Compact JWT.
 * @returns {{header: object, payload: object, input: string, signature: Buffer}} Its parts.
 * @throws {Error} When it is not a compact JWT with JSON parts.
 */
export function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > 256 * 1024) throw new Error('Not a JWT');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) throw new Error('Not a compact JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new Error('Not a JWT');
  return {header, payload, input: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url')};
}

/**
 * Verify a decoded JWT against a public JWK.
 * @param {{header: object, input: string, signature: Buffer}} decoded From decodeJwt.
 * @param {object} jwk Public key.
 * @returns {boolean} Whether the signature is the key's, with an algorithm matching its curve.
 */
export function verifiedWith(decoded, jwk) {
  const curve = CURVES[decoded.header.alg];
  if (!curve || jwk?.kty !== 'EC' || jwk.crv !== curve || jwk.d) return false;
  try {
    const key = crypto.createPublicKey({key: {kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y}, format: 'jwk'});
    return crypto.verify('sha256', Buffer.from(decoded.input), {key, dsaEncoding: 'ieee-p1363'}, decoded.signature);
  } catch {
    return false;
  }
}
