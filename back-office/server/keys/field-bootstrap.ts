import {
  CreateKeyCommand,
  DescribeKeyCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  DecryptCommand,
  KMSClient,
} from '@aws-sdk/client-kms';
import type { Pool, PoolClient } from 'pg';
import { issuanceProtection } from '../issuance/protection.ts';
import { fieldKeyContext, type FieldKeyRecord } from './field-protection.ts';

/** Explicit provisioning inputs; plaintext legacy material is accepted only by the import ceremony. */
export interface FieldBootstrapOptions {
  kmsKeyId?: string;
  development?: boolean;
  legacyKey?: Buffer;
}

/** All protected TS fields and their exact owner AAD, including immutable audit snapshots. */
const encryptedFields = `
  SELECT id::text AS owner, private_data AS ciphertext FROM registered_certificates
  UNION ALL SELECT id::text, decision_encrypted FROM decision_anchors
  UNION ALL SELECT 'presentation:' || state, disclosed_data FROM presentation_sessions WHERE disclosed_data IS NOT NULL
  UNION ALL SELECT 'presentation:' || state, attributes_encrypted FROM presentation_results WHERE attributes_encrypted IS NOT NULL
  UNION ALL SELECT encode(reason_hash,'hex') || ':salt', reason_salt FROM certificate_status_proposals WHERE octet_length(reason_salt)<>32
  UNION ALL SELECT encode(reason_hash,'hex') || ':note', decode(substr(reason_note,8),'base64') FROM certificate_status_proposals WHERE reason_note LIKE 'enc:v1:%'
  UNION ALL SELECT encode(withdrawal_hash,'hex') || ':salt', withdrawal_salt FROM certificate_status_proposals WHERE octet_length(withdrawal_salt)<>32
  UNION ALL SELECT encode(withdrawal_hash,'hex') || ':note', decode(substr(withdrawal_note,8),'base64') FROM certificate_status_proposals WHERE withdrawal_note LIKE 'enc:v1:%'
  UNION ALL SELECT encode(reason_hash,'hex') || ':salt', reason_salt FROM certificate_emergency_suspensions WHERE octet_length(reason_salt)<>32
  UNION ALL SELECT encode(reason_hash,'hex') || ':note', decode(substr(reason_note,8),'base64') FROM certificate_emergency_suspensions WHERE reason_note LIKE 'enc:v1:%'
  UNION ALL SELECT encode(reason_hash,'hex') || ':salt', reason_salt FROM organization_case_cancellations WHERE octet_length(reason_salt)<>32`;

/**
 * Authenticate every existing encrypted field before importing a legacy secret.
 * @param client - Locked provisioning connection.
 * @param key - Proposed former BACK_OFFICE_ISSUANCE_KEY.
 * @returns Number of authenticated envelopes; no plaintext is returned or persisted.
 * @throws If any ciphertext uses another key, is corrupted or cannot authenticate its owner.
 */
async function validateLegacy(client: PoolClient, key: Buffer) {
  const protection = issuanceProtection(key);
  let count = 0;
  await client.query('BEGIN');
  try {
    await client.query('DECLARE legacy_fields NO SCROLL CURSOR FOR ' + encryptedFields);
    for (;;) {
      const { rows } = await client.query('FETCH 100 FROM legacy_fields');
      if (!rows.length) break;
      for (const row of rows) {
        protection.open(row.owner, row.ciphertext);
        count++;
      }
    }
    await client.query('COMMIT');
    return count;
  } catch {
    await client.query('ROLLBACK');
    throw new Error(
      'Legacy key did not authenticate every stored field; no key material was changed.',
    );
  }
}

/**
 * Provision a key pair once, or verify the existing pair through KMS without mutation.
 * @param database - Migrated installation; writers must be stopped for a legacy import.
 * @param kms - Authorized provisioning client (runtime needs only Decrypt).
 * @param options - Existing symmetric KMS locator, local-only creation or explicit legacy import.
 * @returns Public KMS locator and whether this ceremony created the durable record.
 * @throws On conflicts, legacy data without import, KMS failures or an unresolved CreateKey attempt.
 * @remarks The session lock serializes bootstrap. No unwrap failure ever enters a create path.
 * An uncertain CMK creation is recorded before calling KMS and requires explicit locator recovery.
 */
export async function bootstrapFieldKeys(
  database: Pool,
  kms: KMSClient,
  options: FieldBootstrapOptions = {},
) {
  const client = await database.connect();
  const temporary: Uint8Array[] = [];
  await client.query('SELECT pg_advisory_lock(780264170)');
  try {
    if (options.legacyKey && options.legacyKey.length !== 32)
      throw new Error('Expected a 32-byte legacy key.');
    const existing: FieldKeyRecord | undefined = (
      await client.query('SELECT * FROM field_keys WHERE singleton')
    ).rows[0];
    if (existing) {
      if (options.kmsKeyId) {
        const described = await kms.send(new DescribeKeyCommand({ KeyId: options.kmsKeyId }), {
          abortSignal: AbortSignal.timeout(10_000),
        });
        if (described.KeyMetadata?.Arn !== existing.kms_key_id)
          throw new Error('The configured wrapping key conflicts with the stored key.');
      }
      for (const purpose of ['encryption', 'derivation'] as const) {
        const result = await kms.send(
          new DecryptCommand({
            KeyId: existing.kms_key_id,
            CiphertextBlob:
              existing[(purpose + '_wrapped') as 'encryption_wrapped' | 'derivation_wrapped'],
            EncryptionContext: fieldKeyContext(existing.installation_id, purpose),
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (result.Plaintext) temporary.push(result.Plaintext);
        if (result.Plaintext?.length !== 32 || result.KeyId !== existing.kms_key_id)
          throw new Error('Stored field key cannot be authenticated.');
        if (
          purpose === 'derivation' &&
          options.legacyKey &&
          (!existing.legacy_readable || !Buffer.from(result.Plaintext).equals(options.legacyKey))
        )
          throw new Error('Legacy import conflicts with the existing derivation secret.');
      }
      return { kmsKeyId: existing.kms_key_id, created: false };
    }
    const {
      rows: [{ present }],
    } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM (${encryptedFields}) encrypted LIMIT 1) AS present`,
    );
    if (present && !options.legacyKey)
      throw new Error(
        'Existing protected data requires field-keys import-legacy; bootstrap will not generate a replacement.',
      );
    if (options.legacyKey) {
      const count = await validateLegacy(client, options.legacyKey);
      if (present && count === 0)
        throw new Error('No encrypted evidence authenticated the legacy key.');
    }
    await client.query(
      'INSERT INTO field_key_setup(singleton) VALUES (true) ON CONFLICT DO NOTHING',
    );
    let setup = (await client.query('SELECT * FROM field_key_setup WHERE singleton')).rows[0];
    if (setup.kms_key_id && options.kmsKeyId) {
      const metadata = (
        await kms.send(new DescribeKeyCommand({ KeyId: options.kmsKeyId }), {
          abortSignal: AbortSignal.timeout(10_000),
        })
      ).KeyMetadata;
      if (metadata?.Arn !== setup.kms_key_id)
        throw new Error('Wrapping key is already pinned to another locator.');
    }
    if (!setup.kms_key_id) {
      let locator = options.kmsKeyId;
      if (!locator) {
        if (!options.development)
          throw new Error('PLR_FIELD_KMS_KEY_ID is required outside local development.');
        if (setup.creation_started)
          throw new Error(
            'Uncertain KMS creation: recover the original key using PLR_FIELD_KMS_KEY_ID; do not create a replacement.',
          );
        await client.query('UPDATE field_key_setup SET creation_started=true WHERE singleton');
        const result = await kms.send(
          new CreateKeyCommand({
            KeyUsage: 'ENCRYPT_DECRYPT',
            KeySpec: 'SYMMETRIC_DEFAULT',
            Description: 'Atest field envelope wrapping',
            Tags: [{ TagKey: 'atest-installation', TagValue: setup.installation_id }],
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        locator = result.KeyMetadata?.Arn;
        if (!locator)
          throw new Error(
            'KMS did not return the wrapping key locator; explicit recovery required.',
          );
      }
      const metadata = (
        await kms.send(new DescribeKeyCommand({ KeyId: locator }), {
          abortSignal: AbortSignal.timeout(10_000),
        })
      ).KeyMetadata;
      if (
        metadata?.KeySpec !== 'SYMMETRIC_DEFAULT' ||
        metadata.KeyUsage !== 'ENCRYPT_DECRYPT' ||
        metadata.KeyState !== 'Enabled' ||
        !metadata.Arn
      )
        throw new Error('Field protection requires an enabled symmetric ENCRYPT_DECRYPT KMS key.');
      await client.query('UPDATE field_key_setup SET kms_key_id=$1 WHERE singleton', [
        metadata.Arn,
      ]);
      setup = { ...setup, kms_key_id: metadata.Arn };
    }
    const wrapped: Buffer[] = [];
    for (const purpose of ['encryption', 'derivation'] as const) {
      const context = fieldKeyContext(setup.installation_id, purpose);
      if (purpose === 'derivation' && options.legacyKey) {
        const result = await kms.send(
          new EncryptCommand({
            KeyId: setup.kms_key_id,
            Plaintext: options.legacyKey,
            EncryptionContext: context,
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (!result.CiphertextBlob || result.KeyId !== setup.kms_key_id)
          throw new Error('KMS did not wrap the legacy secret.');
        wrapped.push(Buffer.from(result.CiphertextBlob));
      } else {
        const result = await kms.send(
          new GenerateDataKeyCommand({
            KeyId: setup.kms_key_id,
            KeySpec: 'AES_256',
            EncryptionContext: context,
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (result.Plaintext) temporary.push(result.Plaintext);
        if (
          result.Plaintext?.length !== 32 ||
          !result.CiphertextBlob ||
          result.KeyId !== setup.kms_key_id
        )
          throw new Error('KMS did not generate a valid data key.');
        wrapped.push(Buffer.from(result.CiphertextBlob));
      }
    }
    // The pair is published atomically; a failed KMS call cannot publish a partial installation.
    await client.query(
      `INSERT INTO field_keys(singleton,installation_id,kms_key_id,encryption_wrapped,derivation_wrapped,legacy_readable)
      VALUES (true,$1,$2,$3,$4,$5)`,
      [setup.installation_id, setup.kms_key_id, wrapped[0], wrapped[1], Boolean(options.legacyKey)],
    );
    return { kmsKeyId: setup.kms_key_id as string, created: true };
  } finally {
    for (const bytes of temporary) bytes.fill(0);
    await client.query('SELECT pg_advisory_unlock(780264170)');
    client.release();
  }
}
