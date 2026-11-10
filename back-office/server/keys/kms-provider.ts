import { createPublicKey } from 'node:crypto';
import { calculateJwkThumbprint } from 'jose';
import {
  CreateKeyCommand,
  DescribeKeyCommand,
  GetPublicKeyCommand,
  ListResourceTagsCommand,
  KMSClient,
} from '@aws-sdk/client-kms';
import { signingPurposes } from '../../shared/signing-keys.ts';
import type { SigningPurpose } from '../../shared/signing-keys.ts';
import { publicEcKey } from '../ebsi/did-registry.ts';
import type { PublicEcKey } from '../ebsi/did-registry.ts';

/** Purpose-separated KMS ceremonies, including global body-role keys. */
export type CeremonyPurpose = SigningPurpose | 'governance_role_a' | 'governance_role_b';
const ceremonyPurposes = {
  ...signingPurposes,
  governance_role_a: { curve: 'secp256k1' },
  governance_role_b: { curve: 'secp256k1' },
} as const;

/** Verified public material and immutable KMS locator for one purpose. */
export interface KmsKeyMaterial {
  keyId: string;
  publicJwk: PublicEcKey;
  thumbprint: string;
}

/** Ceremony-only KMS operations; runtime signers require no CreateKey permission. */
export interface KeyCeremonyProvider<Purpose extends string = SigningPurpose> {
  inspect(keyId: string, purpose: Purpose): Promise<KmsKeyMaterial>;
  create(purpose: Purpose, requestId: string): Promise<string>;
  createdFor(keyId: string, purpose: Purpose, requestId: string): Promise<void>;
}

/**
 * Create a ceremony adapter around a KMS client configured for one request attempt.
 * @param kms - Dedicated KMS client; automatic retries of CreateKey must be disabled.
 * @returns Public inspection, single-attempt creation and tag-verified recovery operations.
 * @remarks Production uses ceremonyKmsClient; uncertain creation is reconciled through its durable request ID.
 */
export function kmsKeyCeremony(kms: KMSClient): KeyCeremonyProvider<CeremonyPurpose> {
  return {
    /**
     * Load and validate a purpose-specific public key and pin its immutable ARN.
     * @param keyId - KMS key ID, ARN or initial alias.
     * @param purpose - Expected signing purpose and curve.
     * @returns Canonical public key, RFC 7638 thumbprint and immutable KMS key ARN.
     * @throws KMS/crypto errors or Error for a wrong key spec, usage or signing algorithm.
     */
    async inspect(keyId, purpose) {
      const response = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }), {
        abortSignal: AbortSignal.timeout(10_000),
      });
      const curve = ceremonyPurposes[purpose].curve;
      if (
        !response.KeyId?.startsWith('arn:') ||
        response.KeyUsage !== 'SIGN_VERIFY' ||
        response.KeySpec !== (curve === 'P-256' ? 'ECC_NIST_P256' : 'ECC_SECG_P256K1') ||
        !response.SigningAlgorithms?.includes('ECDSA_SHA_256') ||
        !response.PublicKey
      )
        throw new Error('KMS returned an incompatible signing key.');
      const metadata = await kms.send(new DescribeKeyCommand({ KeyId: response.KeyId }), {
        abortSignal: AbortSignal.timeout(10_000),
      });
      if (
        metadata.KeyMetadata?.Arn !== response.KeyId ||
        metadata.KeyMetadata.KeyState !== 'Enabled' ||
        metadata.KeyMetadata.KeyUsage !== 'SIGN_VERIFY'
      )
        throw new Error('The KMS signing key is not enabled.');
      const jwk = createPublicKey({
        key: Buffer.from(response.PublicKey),
        format: 'der',
        type: 'spki',
      }).export({ format: 'jwk' });
      const publicJwk = publicEcKey(jwk, curve);
      return {
        keyId: response.KeyId,
        publicJwk,
        thumbprint: await calculateJwkThumbprint(publicJwk, 'sha256'),
      };
    },
    /**
     * Create exactly one tagged signing key after the caller commits its started intent.
     * @param purpose - Independent key purpose.
     * @param requestId - Durable provisioning request UUID recorded before this call.
     * @returns The created KMS key ARN/ID for immediate durable recording.
     * @throws KMS errors or Error for an incomplete response; every such outcome must be reconciled, not retried blindly.
     */
    async create(purpose, requestId) {
      const attempts = await kms.config.maxAttempts();
      if (attempts !== 1) throw new Error('CreateKey requires a KMS client with maxAttempts=1.');
      const response = await kms.send(
        new CreateKeyCommand({
          KeySpec:
            ceremonyPurposes[purpose].curve === 'P-256' ? 'ECC_NIST_P256' : 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          Description: 'Atest ' + purpose,
          Tags: [
            { TagKey: 'atest-purpose', TagValue: purpose },
            { TagKey: 'atest-request', TagValue: requestId },
          ],
        }),
        { abortSignal: AbortSignal.timeout(15_000) },
      );
      if (!response.KeyMetadata?.KeyId) throw new Error('KMS returned no created key identifier.');
      return response.KeyMetadata.KeyId;
    },
    /**
     * Verify that a recovery key was created for this exact durable request and purpose.
     * @param keyId - Candidate KMS key ID or ARN.
     * @param purpose - Intended signing purpose.
     * @param requestId - Original durable request UUID.
     * @returns Completion only when both ceremony tags match.
     * @throws KMS errors or Error for missing, ambiguous or mismatched tags.
     */
    async createdFor(keyId, purpose, requestId) {
      const tags = [];
      let marker: string | undefined;
      const seen = new Set<string>();
      do {
        const response = await kms.send(
          new ListResourceTagsCommand({ KeyId: keyId, Marker: marker, Limit: 50 }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        tags.push(...(response.Tags ?? []));
        marker = response.Truncated ? response.NextMarker : undefined;
        if (response.Truncated && (!marker || seen.has(marker) || seen.size >= 20))
          throw new Error('KMS tag pagination is invalid.');
        if (marker) seen.add(marker);
      } while (marker);
      for (const [name, expected] of [
        ['atest-purpose', purpose],
        ['atest-request', requestId],
      ]) {
        const matches = tags.filter((tag) => tag.TagKey === name);
        if (matches.length !== 1 || matches[0].TagValue !== expected)
          throw new Error('The KMS key does not belong to this creation request.');
      }
    },
  };
}

/**
 * Create a dedicated single-attempt client for key ceremonies.
 * @param env - AWS region and optional development KMS endpoint.
 * @returns A KMS client owned and destroyed by the CLI.
 * @throws Error if the AWS region is not configured.
 */
export function ceremonyKmsClient(env = process.env): KMSClient {
  if (!env.AWS_REGION?.trim()) throw new Error('Set AWS_REGION for the key ceremony.');
  return new KMSClient({
    region: env.AWS_REGION,
    endpoint: env.PLR_KMS_ENDPOINT_URL || undefined,
    maxAttempts: 1,
  });
}
