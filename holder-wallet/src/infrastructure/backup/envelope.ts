// The backup as it leaves the phone, and the proof that goes with it (D31).
// Sealed with AES-256-GCM: a format byte, a fresh 12-byte IV, the 16-byte tag
// and the ciphertext, in base64url. The backup's address is the additional
// data, so a ciphertext moved to another address does not open. The proof is
// an ES256 JWS by the backup's signing key over the address, the version, a
// digest of the ciphertext and the time (back-office/server/backup/service.ts).
import { base64url } from 'jose'
import { BackupKeys, sha256 } from './keys'
import { IV_BYTES, TAG_BYTES, bytes, concat, gcmOpen, gcmSeal } from '@infrastructure/crypto/aesGcm'

const FORMAT = 1

export const PROOF_TYPE = 'plr-wallet-backup+jwt'

const utf8 = (text: string): Uint8Array => bytes(Buffer.from(text, 'utf8'))

export const seal = (keys: BackupKeys, plaintext: string): string => {
  const { iv, ciphertext, tag } = gcmSeal(keys.encryptionKey, utf8(keys.backupId), utf8(plaintext))
  return base64url.encode(concat(Uint8Array.of(FORMAT), iv, tag, ciphertext))
}

/** The plaintext, or an error when the ciphertext is not this backup's. */
export const open = (keys: BackupKeys, ciphertext: string): string => {
  const raw = base64url.decode(ciphertext)
  if (raw.length < 1 + IV_BYTES + TAG_BYTES || raw[0] !== FORMAT) throw new Error('Not a wallet backup')
  const iv = raw.subarray(1, 1 + IV_BYTES)
  const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const plain = gcmOpen(keys.encryptionKey, utf8(keys.backupId), iv, raw.subarray(1 + IV_BYTES + TAG_BYTES), tag)
  return Buffer.from(plain).toString('utf8')
}

export const digest = (ciphertext: string): string => base64url.encode(sha256(ciphertext))

const encode = (value: object) => base64url.encode(utf8(JSON.stringify(value)))

/** An ES256 JWS by the backup's key, its public key in the header. */
export const proof = (keys: BackupKeys, claims: Record<string, unknown>, now = Date.now()): string => {
  const header = { alg: 'ES256', typ: PROOF_TYPE, jwk: keys.publicJwk }
  const payload = { backup: keys.backupId, iat: Math.floor(now / 1000), ...claims }
  const input = `${encode(header)}.${encode(payload)}`
  const signature = keys.signingKey.sign(Array.from(sha256(input)))
  const raw = concat(bytes(signature.r.toArray('be', 32)), bytes(signature.s.toArray('be', 32)))
  return `${input}.${base64url.encode(raw)}`
}
