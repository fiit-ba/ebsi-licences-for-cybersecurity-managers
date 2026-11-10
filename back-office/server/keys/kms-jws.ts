import { createHash, createPublicKey, verify } from 'node:crypto';
import { SignCommand } from '@aws-sdk/client-kms';
import { rawEcdsaSignature } from '../issuance/kms-ecdsa.ts';
import type { KmsSigningClient } from '../issuance/kms-types.ts';
import type { PublicEcKey } from '../ebsi/did-registry.ts';

const orders = {
  'P-256': 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  secp256k1: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
} as const;

/** A JOSE signing key held by KMS, named by the DID URL a verifier resolves it with. */
export interface JwsSigner {
  alg: 'ES256' | 'ES256K';
  kid: string;
  publicJwk: PublicEcKey;
  sign(input: Uint8Array): Promise<Uint8Array>;
}

/**
 * Wrap one KMS key as a JWS signer: ES256 for a P-256 key, ES256K for a secp256k1 key.
 *
 * @param kms - KMS client allowed to sign with the key.
 * @param key - The key's immutable KMS locator, its public JWK and its DID URL.
 * @returns A signer producing verified 64-byte IEEE-P1363 signatures.
 * @throws Error for a public key of another curve.
 * @remarks Every signature is checked against the public key before it is returned, so a
 * swapped KMS key cannot sign for a DID URL it does not hold.
 */
export function kmsJwsSigner(
  kms: KmsSigningClient,
  key: { kmsKeyId: string; publicJwk: PublicEcKey; kid: string },
): JwsSigner {
  const { kty, crv, x, y } = key.publicJwk;
  if (kty !== 'EC' || !(crv in orders)) throw new Error('Unsupported JWS signing key.');
  const publicKey = createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' });
  return {
    alg: crv === 'P-256' ? 'ES256' : 'ES256K',
    kid: key.kid,
    publicJwk: { kty, crv, x, y },
    /**
     * Sign JWS input with KMS.
     * @param input - Exact protected header and payload bytes.
     * @returns The verified raw signature.
     * @throws KMS errors, or Error for a missing or mismatched signature.
     */
    async sign(input) {
      const result = await kms.send(
        new SignCommand({
          KeyId: key.kmsKeyId,
          Message: createHash('sha256').update(input).digest(),
          MessageType: 'DIGEST',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (!result.Signature || result.SigningAlgorithm !== 'ECDSA_SHA_256')
        throw new Error('KMS did not return an ECDSA signature.');
      const signature = rawEcdsaSignature(result.Signature, orders[crv]);
      if (!verify('sha256', input, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature))
        throw new Error('The KMS signature does not match the published key.');
      return signature;
    },
  };
}

/**
 * Sign a compact JWT.
 *
 * @param signer - JWS signer; its algorithm and kid go into the header.
 * @param payload - Claims.
 * @param header - Additional protected header members, such as `jwk` or `typ`.
 * @returns The compact JWT.
 * @throws Signer errors.
 */
export async function signJwt(
  signer: JwsSigner,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: signer.alg, typ: 'JWT', kid: signer.kid, ...header })}.${encode(payload)}`;
  const signature = await signer.sign(Buffer.from(input, 'ascii'));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
