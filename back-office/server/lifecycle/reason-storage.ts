import type { Protection } from '../issuance/protection.ts';
import { reasonCommitment } from '../issuance/protection.ts';

/** Case reason fields, optionally encrypted when installation field protection is configured. */
export interface StoredReason {
  reason_code: string;
  reason_note: string;
  reason_salt: Buffer;
  reason_hash: Buffer;
}

/**
 * Preserve the reason commitment while encrypting its note and salt at rest.
 * @param code - Validated reason category.
 * @param note - Trimmed private case note.
 * @param salt - Independent random 32-byte reason salt.
 * @param protection - Configured installation field encryption; absent in unprotected test fixtures.
 * @returns Stored fields; only the category and commitment remain plaintext when protected.
 * @throws Crypto or serialization errors.
 */
export async function storeReason(
  code: string,
  note: string,
  salt: Buffer,
  protection?: Protection,
): Promise<StoredReason> {
  const hash = reasonCommitment(code, note, salt);
  const binding = hash.toString('hex');
  return {
    reason_code: code,
    reason_hash: hash,
    reason_note: protection
      ? 'enc:v1:' + (await protection.seal(binding + ':note', note)).toString('base64')
      : note,
    reason_salt: protection ? await protection.seal(binding + ':salt', salt.toString('hex')) : salt,
  };
}

/**
 * Authenticate and open reason fields without returning mismatched commitment material.
 * @param stored - Existing note, salt, category and commitment from the same case.
 * @param protection - Installation encryption key required for protected fields.
 * @returns Private reason category, note and raw 32-byte salt.
 * @throws Error for absent protection, corruption or a reason commitment mismatch; crypto/JSON errors.
 */
export async function openReason(stored: StoredReason, protection?: Protection) {
  let note = stored.reason_note;
  let salt = stored.reason_salt;
  if (salt.length !== 32) {
    if (!protection) throw new Error('Case field protection is unavailable.');
    const binding = stored.reason_hash.toString('hex');
    if (note.startsWith('enc:v1:'))
      note = await protection.open(binding + ':note', Buffer.from(note.slice(7), 'base64'));
    const hex = await protection.open(binding + ':salt', salt);
    if (typeof note !== 'string' || typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex))
      throw new Error('Invalid encrypted case reason.');
    salt = Buffer.from(hex, 'hex');
  }
  if (!reasonCommitment(stored.reason_code, note, salt).equals(stored.reason_hash))
    throw new Error('The recorded reason does not match its commitment.');
  return { code: stored.reason_code, note, salt };
}
