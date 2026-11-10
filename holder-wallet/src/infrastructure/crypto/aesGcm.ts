// AES-256-GCM, as the wallet's backup (design decisions D31) and its exchanges
// (D33) seal what they send: a fresh 12-byte IV each time, a 16-byte tag, and
// data authenticated alongside. Each lays the parts out in its own format.
import Crypto from 'react-native-quick-crypto'

export const IV_BYTES = 12
export const TAG_BYTES = 16

/** Bytes as the wallet holds them: Buffer and Uint8Array alike. */
type Bytes = Uint8Array | Buffer

const buffer = (value: Bytes): any => Buffer.from(value as Uint8Array)

export const bytes = (value: unknown): Uint8Array => Uint8Array.from(value as ArrayLike<number>)

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** `plaintext` sealed under `key`, `aad` authenticated with it. */
export const gcmSeal = (key: Bytes, aad: Bytes, plaintext: Bytes) => {
  const iv = bytes(Crypto.randomBytes(IV_BYTES))
  const cipher = Crypto.createCipheriv('aes-256-gcm', buffer(key), buffer(iv))
  cipher.setAAD(buffer(aad))
  const ciphertext = concat(bytes(cipher.update(buffer(plaintext))), bytes(cipher.final()))
  return { iv, ciphertext, tag: bytes(cipher.getAuthTag()) }
}

/** The plaintext, or an error when the tag does not authenticate it and `aad`. */
export const gcmOpen = (key: Bytes, aad: Bytes, iv: Bytes, ciphertext: Bytes, tag: Bytes): Uint8Array => {
  const decipher = Crypto.createDecipheriv('aes-256-gcm', buffer(key), buffer(iv))
  decipher.setAAD(buffer(aad))
  decipher.setAuthTag(buffer(tag))
  return concat(bytes(decipher.update(buffer(ciphertext))), bytes(decipher.final()))
}
