import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Encode an unsigned length as a Solidity ABI word.
 *
 * @param number - Nonnegative integer length that fits uint64.
 * @returns A zero-padded 32-byte word.
 * @throws RangeError for an out-of-range length.
 */
function word(number: number) {
  const result = Buffer.alloc(32);
  result.writeBigUInt64BE(BigInt(number), 24);
  return result;
}

/**
 * Hash Solidity ABI-encoded dynamic strings and an optional static word.
 *
 * @param strings - Strings in ABI parameter order.
 * @param staticWord - Optional final static 32-byte parameter.
 * @returns The SHA-256 digest of the ABI encoding.
 * @throws RangeError if a string length cannot be encoded as an unsigned 64-bit word.
 */
function encodedDigest(strings: string[], staticWord?: Buffer) {
  // Solidity ABI dynamic strings use offsets followed by
  // length-prefixed, word-padded UTF-8 values.
  const tails = strings.map((value) => {
    const bytes = Buffer.from(value);
    return Buffer.concat([
      word(bytes.length),
      bytes,
      Buffer.alloc((32 - (bytes.length % 32)) % 32),
    ]);
  });
  let offset = 32 * (tails.length + Number(Boolean(staticWord)));
  const offsets = tails.map((tail) => {
    const start = word(offset);
    offset += tail.length;
    return start;
  });
  return createHash('sha256')
    .update(Buffer.concat([...offsets, ...(staticWord ? [staticWord] : []), ...tails]))
    .digest();
}

/**
 * Hash a collected credential's identifier as the certificate registry keeps it.
 *
 * @param certificateId - The signed credential's `vc.id`, for example `urn:uuid:…`.
 * @returns SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", certificateId)), the contract's
 * `Hashes.certificateIdHash`.
 */
export function certificateIdHash(certificateId: string) {
  return encodedDigest(['PLR-CERTIFICATE-ID-V1', certificateId]);
}

/**
 * Derive the key a collected certificate's record is kept under on the certificate registry.
 *
 * @param issuerDid - DID of the TI that issued the credential.
 * @param certificateId - The signed credential's `vc.id`.
 * @returns SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash)), the
 * contract's `Hashes.statusKey`; contracts/test/CommitmentInterop.t.sol compares both.
 * @remarks Every verifier computes the same key from the credential it is shown, so the key is
 * not carried in the credential.
 */
export function certificateStatusKey(issuerDid: string, certificateId: string) {
  return encodedDigest(['PLR-CERTIFICATE-V4', issuerDid], certificateIdHash(certificateId));
}

/**
 * Hash the signed part of an issued credential as the certificate registry records it.
 *
 * @param credential - Issued credential, optionally followed by `~`-separated disclosures.
 * @returns SHA-256 of the JWT before its first `~`, identical for every presentation.
 */
export function credentialHash(credential: string) {
  return createHash('sha256').update(credential.split('~')[0]).digest();
}

/**
 * Commit to a reason and note with a private random salt.
 *
 * @param reason - Canonical reason code.
 * @param note - Exact normalized reason note.
 * @param salt - Exactly 32 salt bytes.
 * @returns The PLR-REASON-V1 ABI commitment digest.
 * @throws Error if the salt is not 32 bytes.
 */
export function reasonCommitment(reason: string, note: string, salt: Buffer) {
  if (salt.length !== 32) throw new Error('Expected a 32-byte reason salt.');
  return encodedDigest(['PLR-REASON-V1', reason, note], salt);
}

/**
 * Hash a bearer secret for database lookup.
 *
 * @param value - String or bytes containing the secret.
 * @returns A 32-byte SHA-256 digest.
 */
export function secretDigest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest();
}

export const preAuthorizedGrant = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';
export const maxPinAttempts = 5;

/** Existing deployment policy for offer expiry and the separately delivered PIN. */
export interface OfferPolicy {
  ttlMinutes?: number;
  requirePin?: boolean;
  pinDigits?: number;
}

/** Field protection may unwrap its purpose-bound keys asynchronously through KMS. */
export type Protection = {
  [Name in keyof ReturnType<typeof issuanceProtection>]: (
    ...args: Parameters<ReturnType<typeof issuanceProtection>[Name]>
  ) =>
    | ReturnType<ReturnType<typeof issuanceProtection>[Name]>
    | Promise<ReturnType<ReturnType<typeof issuanceProtection>[Name]>>;
};

/**
 * Create authenticated encryption, PIN validation and commitment derivation.
 *
 * @param key - Persistent 32-byte secret shared across deployments.
 * @param policy - Existing PLR offer settings; defaults to one hour and six required digits.
 * @param encryptionKey - Independent AES data key; defaults to key only for legacy/test compatibility.
 * @returns Operations for bound encrypted envelopes, offer secrets and stable salts.
 * @throws Error if key is not a 32-byte Buffer or the offer policy is out of range.
 * @remarks Production obtains both secrets from KMS; this primitive performs no key provisioning.
 */
export function issuanceProtection(key: Buffer, policy: OfferPolicy = {}, encryptionKey = key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error('Issuance data encryption requires a 32-byte key.');
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)
    throw new Error('Expected a separate 32-byte encryption key.');
  const { ttlMinutes = 60, requirePin = true, pinDigits = 6 } = policy;
  if (
    !Number.isSafeInteger(ttlMinutes) ||
    ttlMinutes < 1 ||
    ttlMinutes > 525600 ||
    !Number.isSafeInteger(pinDigits) ||
    pinDigits < 1 ||
    pinDigits > 128 ||
    typeof requirePin !== 'boolean'
  )
    throw new Error('Configure a positive offer lifetime and one to 128 PIN digits.');
  const pinDigest = (code: string, pin: string) =>
    createHmac('sha256', key).update('offer-pin:').update(code).update(':').update(pin).digest();

  return {
    /**
     * Derive a stable private salt for a certificate.
     *
     * @param certificateId - Internal certificate UUID.
     * @returns A 32-byte domain-separated HMAC digest.
     */
    commitmentSalt(certificateId: string) {
      return createHmac('sha256', key)
        .update('certificate-commitment-salt:')
        .update(certificateId)
        .digest();
    },
    /**
     * Compare the supplied offer/PIN pair against its stored digest.
     *
     * @param code - Raw pre-authorized code.
     * @param pin - Candidate PIN.
     * @param digest - Stored 32-byte PIN digest.
     * @returns Whether the HMAC digests match.
     * @throws RangeError if the stored digest length differs.
     */
    matchesPin(code: string, pin: string, digest: Buffer) {
      return timingSafeEqual(pinDigest(code, pin), digest);
    },
    /**
     * Encrypt JSON data and bind the envelope to its owning identifier.
     *
     * @param certificateId - Certificate or presentation identifier used as authenticated data.
     * @param data - JSON-serializable private data.
     * @returns An envelope containing IV, GCM tag and ciphertext.
     * @throws Serialization or crypto errors if the payload cannot be encrypted.
     */
    seal(certificateId: string, data: unknown) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(Buffer.from(certificateId));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    /**
     * Authenticate and decrypt a bound private-data envelope.
     *
     * @param certificateId - The same owner identifier passed to seal.
     * @param envelope - Stored IV, authentication tag and ciphertext.
     * @returns The parsed JSON payload.
     * @throws Crypto or JSON errors for a wrong owner, wrong key, corruption or invalid payload.
     */
    open(certificateId: string, envelope: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, envelope.subarray(0, 12));
      decipher.setAAD(Buffer.from(certificateId));
      decipher.setAuthTag(envelope.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString('utf8'),
      );
    },
    /**
     * Generate an expiring holder offer and its configured separate PIN.
     *
     * @returns Raw code and PIN, their storage digests and expiry.
     * @throws Crypto errors if secure randomness is unavailable.
     */
    newOffer() {
      const code = randomBytes(32).toString('base64url');
      const pin = requirePin
        ? Array.from({ length: pinDigits }, () => randomInt(10)).join('')
        : null;
      return {
        code,
        pin,
        codeDigest: secretDigest(code),
        pinDigest: pin === null ? Buffer.alloc(0) : pinDigest(code, pin),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      };
    },
  };
}
