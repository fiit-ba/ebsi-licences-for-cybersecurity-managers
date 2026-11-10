import { DecryptCommand, DescribeKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import type { Pool } from 'pg';
import pg from 'pg';
import { issuanceProtection, type OfferPolicy, type Protection } from '../issuance/protection.ts';
import { IssuanceError } from '../issuance/claims.ts';

/** Durable, immutable references to independently wrapped encryption and derivation material. */
export interface FieldKeyRecord {
  installation_id: string;
  kms_key_id: string;
  encryption_wrapped: Buffer;
  derivation_wrapped: Buffer;
  legacy_readable: boolean;
}

/** Explicit version marker; the complete marker and owner are authenticated as AES-GCM AAD. */
const prefix = Buffer.from('ATSTKMS2\0');

/**
 * Bind a KMS ciphertext to this installation and the key's single purpose.
 * @param installation - Durable installation UUID.
 * @param purpose - Data encryption or stable offer/commitment derivation.
 * @returns Nonsecret authenticated KMS encryption context.
 */
export function fieldKeyContext(installation: string, purpose: 'encryption' | 'derivation') {
  return { application: 'atest-back-office', installation, purpose };
}

/**
 * Create a read-only, lazy envelope-encryption runtime; it never creates or replaces keys.
 * @param database - Migrated PostgreSQL pool.
 * @param env - KMS location and existing offer policy; no plaintext data key is accepted.
 * @returns Asynchronous protection operations and memory/client cleanup.
 * @throws Configuration errors immediately; operations refuse with 503 on missing keys or KMS failure.
 * @remarks Successful unwraps live only in process memory until close/restart. A warm process can
 * Continue during a KMS outage using already unwrapped keys. Failed unwraps are retried, never cached.
 */
export function configuredFieldProtection(
  database: Pool,
  env = process.env,
): Protection & { close(): void } {
  if (env.BACK_OFFICE_ISSUANCE_KEY)
    throw new Error(
      'Remove BACK_OFFICE_ISSUANCE_KEY after the explicit field-keys import-legacy ceremony.',
    );
  const kms = new KMSClient({
    region: env.AWS_REGION,
    endpoint: env.PLR_KMS_ENDPOINT_URL || undefined,
    maxAttempts: 2,
  });
  const policy: OfferPolicy = {
    ttlMinutes: Number(env.PLR_OFFER_TTL_MINUTES ?? 60),
    requirePin: env.PLR_OFFER_REQUIRE_PIN !== 'false',
    pinDigits: Number(env.PLR_OFFER_PIN_DIGITS ?? 6),
  };
  if (env.PLR_OFFER_REQUIRE_PIN && !['true', 'false'].includes(env.PLR_OFFER_REQUIRE_PIN))
    throw new Error('PLR_OFFER_REQUIRE_PIN must be true or false.');
  // Validate policy without making a KMS request or retaining a placeholder key.
  const validationKey = Buffer.alloc(32);
  issuanceProtection(validationKey, policy);
  validationKey.fill(0);
  let material: Buffer[] = [];
  let loaded:
    | Promise<{
        current: ReturnType<typeof issuanceProtection>;
        legacy?: ReturnType<typeof issuanceProtection>;
      }>
    | undefined;
  let closed = false;

  /**
   * Coalesce concurrent cold operations and unwrap exactly the stored key pair.
   * @returns In-memory cryptographic operations using the pinned material.
   * @throws A public unavailable refusal, without exposing KMS errors or ciphertext.
   */
  async function keys() {
    if (closed)
      throw new IssuanceError(503, 'FieldEncryptionUnavailable', 'Field protection is closed.');
    loaded ??= (async () => {
      // Business transactions may already occupy every pool connection while waiting for
      // this cold load. A short independent lookup avoids waiting on those same transactions.
      const source = new pg.Client({ ...database.options, connectionTimeoutMillis: 3000 });
      let record: FieldKeyRecord | undefined;
      try {
        await source.connect();
        record = (await source.query('SELECT * FROM field_keys WHERE singleton')).rows[0];
      } finally {
        await source.end();
      }
      if (!record) throw new Error('Missing field key; explicit bootstrap/import required.');
      if (env.PLR_FIELD_KMS_KEY_ID && env.PLR_FIELD_KMS_KEY_ID !== record.kms_key_id) {
        const configured = await kms.send(
          new DescribeKeyCommand({ KeyId: env.PLR_FIELD_KMS_KEY_ID }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (configured.KeyMetadata?.Arn !== record.kms_key_id)
          throw new Error('Configured field key conflicts with its pinned locator.');
      }
      const unwrapped: Buffer[] = [];
      try {
        for (const purpose of ['encryption', 'derivation'] as const) {
          const response = await kms.send(
            new DecryptCommand({
              KeyId: record.kms_key_id,
              CiphertextBlob:
                record[(purpose + '_wrapped') as 'encryption_wrapped' | 'derivation_wrapped'],
              EncryptionContext: fieldKeyContext(record.installation_id, purpose),
            }),
            { abortSignal: AbortSignal.timeout(10_000) },
          );
          const bytes = Buffer.from(response.Plaintext ?? []);
          response.Plaintext?.fill(0);
          unwrapped.push(bytes);
          if (bytes.length !== 32 || response.KeyId !== record.kms_key_id)
            throw new Error('KMS returned invalid data-key material.');
        }
        if (closed) throw new Error('Field protection closed during unwrap.');
        material = unwrapped;
        return {
          current: issuanceProtection(unwrapped[1], policy, unwrapped[0]),
          legacy: record.legacy_readable ? issuanceProtection(unwrapped[1], policy) : undefined,
        };
      } catch (error) {
        for (const bytes of unwrapped) bytes.fill(0);
        throw error;
      }
    })().catch(() => {
      loaded = undefined;
      throw new IssuanceError(
        503,
        'FieldEncryptionUnavailable',
        'KMS-protected field keys are unavailable.',
      );
    });
    return loaded;
  }

  return {
    commitmentSalt: async (id) => (await keys()).current.commitmentSalt(id),
    matchesPin: async (code, pin, digest) => (await keys()).current.matchesPin(code, pin, digest),
    newOffer: async () => (await keys()).current.newOffer(),
    seal: async (owner, data) =>
      Buffer.concat([
        prefix,
        (await keys()).current.seal(prefix.toString('hex') + ':' + owner, data),
      ]),
    /**
     * Authenticate a versioned envelope or explicitly imported legacy ciphertext.
     * @param owner - Original owning identifier.
     * @param envelope - Stored authenticated ciphertext.
     * @returns Decrypted JSON only after successful KMS unwrap and GCM authentication.
     * @throws Unavailable refusals or authentication/format errors.
     */
    async open(owner, envelope) {
      const { current, legacy } = await keys();
      if (envelope.subarray(0, prefix.length).equals(prefix))
        return current.open(prefix.toString('hex') + ':' + owner, envelope.subarray(prefix.length));
      if (!legacy) throw new Error('Unversioned ciphertext requires explicit legacy key import.');
      return legacy.open(owner, envelope);
    },
    /**
     * Zero owned plaintext buffers and prevent further use of this runtime.
     * @returns No return value.
     */
    close() {
      closed = true;
      for (const bytes of material) bytes.fill(0);
      material = [];
      loaded = undefined;
      kms.destroy();
    },
  };
}
