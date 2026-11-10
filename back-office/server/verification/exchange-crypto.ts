import { createECDH, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { publicEcKey } from '../ebsi/did-registry.ts';
import type { PublicEcKey } from '../ebsi/did-registry.ts';

/** Ephemeral P-256 exchange key; the private scalar belongs only in the expiring cache. */
export interface ExchangeKey {
  privateKey: string;
  publicKey: PublicEcKey;
}

/** VC-API envelope; data includes the AES-GCM authentication tag. */
export interface ExchangeEnvelope {
  iv: string;
  data: string;
  epk?: PublicEcKey;
}

/**
 * Generate a P-256 ephemeral key for the holder-exchange protocol.
 * @returns Public JWK and private scalar for an exchange lasting five minutes.
 */
export function exchangeKey(): ExchangeKey {
  const key = createECDH('prime256v1');
  key.generateKeys();
  const point = key.getPublicKey();
  return {
    privateKey: key.getPrivateKey().toString('base64url'),
    publicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
  };
}

/**
 * Derive the exact ECDH/HKDF key for one exchange direction.
 * @param mine - Local private scalar.
 * @param theirs - Peer P-256 public JWK.
 * @param id - Wallet exchange identifier.
 * @param direction - Request/response HKDF context.
 * @returns 32-byte AES key.
 * @throws Invalid-key errors for malformed or off-curve points.
 */
function envelopeKey(mine: string, theirs: unknown, id: string, direction: 'request' | 'response') {
  const peer = publicEcKey(theirs, 'P-256');
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(mine, 'base64url'));
  const secret = key.computeSecret(
    Buffer.concat([
      Buffer.from([4]),
      Buffer.from(peer.x, 'base64url'),
      Buffer.from(peer.y, 'base64url'),
    ]),
  );
  return Buffer.from(
    hkdfSync('sha256', secret, Buffer.from(id), Buffer.from('PLR-EXCHANGE-V1/' + direction), 32),
  );
}

/**
 * Seal a VC-API message using direction-bound AES-256-GCM.
 * @param mine - Verifier's ephemeral exchange key.
 * @param theirs - Wallet public key from the invitation.
 * @param id - Wallet exchange ID.
 * @param direction - Request/response direction.
 * @param value - JSON message.
 * @param withKey - Whether to attach the initial public epk.
 * @returns Interoperable envelope.
 * @throws Key, encryption or JSON encoding errors.
 */
export function sealExchange(
  mine: ExchangeKey,
  theirs: unknown,
  id: string,
  direction: 'request' | 'response',
  value: unknown,
  withKey = false,
): ExchangeEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    envelopeKey(mine.privateKey, theirs, id, direction),
    iv,
  );
  cipher.setAAD(Buffer.from(id + '/' + direction));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    ...(withKey ? { epk: mine.publicKey } : {}),
    iv: iv.toString('base64url'),
    data: data.toString('base64url'),
  };
}

/**
 * Open a response without accepting malformed JSON or the wrong direction.
 * @param mine - Verifier private scalar from TTL cache.
 * @param theirs - Wallet public key.
 * @param id - Wallet exchange ID.
 * @param direction - Expected request/response context.
 * @param envelope - Untrusted encrypted message.
 * @returns The authenticated JSON message.
 * @throws Key, GCM, JSON or shape errors; callers map these to exchange failure.
 */
export function openExchange(
  mine: string,
  theirs: unknown,
  id: string,
  direction: 'request' | 'response',
  envelope: ExchangeEnvelope,
) {
  const data = Buffer.from(envelope.data, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    envelopeKey(mine, theirs, id, direction),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(id + '/' + direction));
  decipher.setAuthTag(data.subarray(-16));
  const value = JSON.parse(
    Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8'),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Not an exchange answer');
  return value;
}
