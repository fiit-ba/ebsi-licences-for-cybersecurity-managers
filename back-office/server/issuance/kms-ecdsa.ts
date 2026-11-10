/**
 * Decode an ECDSA DER signature into canonical fixed-width r and s.
 *
 * @param signature - DER signature bytes from KMS.
 * @param order - Curve subgroup order used for scalar bounds and low-s normalization.
 * @returns A 64-byte IEEE-P1363 signature.
 * @throws Error for malformed DER, invalid scalar length or out-of-range values.
 */
export function rawEcdsaSignature(signature: Uint8Array, order: bigint) {
  const der = Buffer.from(signature);
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    throw new Error('KMS returned an invalid ECDSA signature.');
  }
  let cursor = 2;
  /**
   * Read the next DER INTEGER and validate its canonical curve scalar encoding.
   *
   * @returns The positive scalar below the configured curve order.
   * @throws Error for malformed DER, noncanonical integers or out-of-range scalars.
   */
  function scalar() {
    const tag = der[cursor++];
    const length = der[cursor++];
    const bytes = der.subarray(cursor, cursor + length);
    cursor += length;
    if (
      tag !== 2 ||
      !length ||
      length > 33 ||
      bytes.length !== length ||
      bytes[0] & 0x80 ||
      (length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80))
    ) {
      throw new Error('KMS returned an invalid ECDSA scalar.');
    }
    const value = BigInt('0x' + bytes.toString('hex'));
    if (value === 0n || value >= order)
      throw new Error('KMS returned an out-of-range ECDSA scalar.');
    return value;
  }
  const r = scalar();
  const s = scalar();
  if (cursor !== der.length) throw new Error('KMS returned trailing signature data.');
  return Buffer.from(
    r.toString(16).padStart(64, '0') +
      (s > order / 2n ? order - s : s).toString(16).padStart(64, '0'),
    'hex',
  );
}
