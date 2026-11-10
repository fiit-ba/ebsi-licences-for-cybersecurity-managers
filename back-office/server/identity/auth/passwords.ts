import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Request ceiling bounding plaintext inputs to account services. */
export const maxPasswordBytes = 2_621_440;

const keyLength = 64;
const dummySalt = Buffer.alloc(16);

/**
 * Derive the fixed native password key without accepting stored cost parameters.
 * @param password - Exact plaintext candidate, never logged or persisted here.
 * @param salt - Sixteen-byte account salt, or the dummy salt for unknown accounts.
 * @returns The 64-byte scrypt key for constant-time comparison or storage.
 * @throws Node crypto errors if derivation fails.
 */
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/**
 * Hash a new or explicitly changed password with a fresh native scrypt salt.
 * @param password - Plaintext password validated by the caller's account policy.
 * @returns Hexadecimal salt and 64-byte derived key, separated by a colon.
 * @throws Node crypto errors if randomness or derivation fails.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * Verify a password created by this backend's native scrypt encoder.
 * @param password - Exact plaintext candidate; Unicode is not normalized.
 * @param encoded - Stored hash; absent, disabled and malformed values cannot match.
 * @returns Whether the candidate matches, using a constant-time key comparison.
 * @throws Node crypto errors if derivation fails.
 * @remarks Unknown accounts and invalid encodings perform the same scrypt work.
 * Imported password encodings are deliberately unsupported on the fresh deployment.
 */
export async function passwordMatches(password: string, encoded?: string): Promise<boolean> {
  const valid = encoded?.length === 161 && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded);
  const salt = valid ? Buffer.from(encoded.slice(0, 32), 'hex') : dummySalt;
  const expected = valid ? Buffer.from(encoded.slice(33), 'hex') : Buffer.alloc(keyLength);
  const candidate = await derive(password, salt);
  return timingSafeEqual(candidate, expected) && Boolean(valid);
}
