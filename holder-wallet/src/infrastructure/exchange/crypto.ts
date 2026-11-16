// What two phones say to each other during an exchange is encrypted end to
// end (design decisions D33): ECDH on P-256 between a key the holder shows in its
// QR code and a key the verifier sends with its request, HKDF-SHA-256 under
// the exchange's id and the direction, and AES-256-GCM. Both keys live as
// long as the exchange. The Wi-Fi in between - and anyone on it - sees only
// ciphertext, even though the connection itself is plain HTTP.
import Crypto from 'react-native-quick-crypto'
import { ec as EC } from 'elliptic'
import { base64url } from 'jose'
import { PublicJwk, p256, publicJwk, publicKeyOf } from '@infrastructure/crypto/p256'
import { IV_BYTES, TAG_BYTES, bytes, concat, gcmOpen, gcmSeal } from '@infrastructure/crypto/aesGcm'

export type Direction = 'request' | 'response'

export type Envelope = {
  /** The sender's ephemeral key: the verifier's, on its request. */
  epk?: PublicJwk
  iv: string
  /** Ciphertext and tag, in base64url. */
  data: string
}

export const newEphemeralKey = (): EC.KeyPair => p256.genKeyPair()

export { publicJwk }

const pointOf = (jwk: PublicJwk) => publicKeyOf(jwk).getPublic()

const keyFor = (mine: EC.KeyPair, theirs: PublicJwk, exchangeId: string, direction: Direction): Buffer => {
  const secret = Buffer.from(mine.derive(pointOf(theirs)).toArray('be', 32))
  return Buffer.from(Crypto.hkdfSync('sha256', secret as any, exchangeId, `PLR-EXCHANGE-V1/${direction}`, 32) as any)
}

const aad = (exchangeId: string, direction: Direction) => bytes(Buffer.from(`${exchangeId}/${direction}`, 'utf8'))

export const seal = (
  mine: EC.KeyPair,
  theirs: PublicJwk,
  exchangeId: string,
  direction: Direction,
  value: unknown,
  withKey = false,
): Envelope => {
  const sealed = gcmSeal(
    keyFor(mine, theirs, exchangeId, direction),
    aad(exchangeId, direction),
    bytes(Buffer.from(JSON.stringify(value), 'utf8')),
  )
  return {
    ...(withKey ? { epk: publicJwk(mine) } : {}),
    iv: base64url.encode(sealed.iv),
    data: base64url.encode(concat(sealed.ciphertext, sealed.tag)),
  }
}

/** The value inside, or an error when it is not this exchange's. */
export const open = (
  mine: EC.KeyPair,
  theirs: PublicJwk,
  exchangeId: string,
  direction: Direction,
  envelope: Envelope,
) => {
  const iv = base64url.decode(String(envelope?.iv ?? ''))
  const raw = base64url.decode(String(envelope?.data ?? ''))
  if (iv.length !== IV_BYTES || raw.length < TAG_BYTES) throw new Error('Not an exchange envelope')
  const plain = gcmOpen(
    keyFor(mine, theirs, exchangeId, direction),
    aad(exchangeId, direction),
    iv,
    raw.subarray(0, raw.length - TAG_BYTES),
    raw.subarray(raw.length - TAG_BYTES),
  )
  return JSON.parse(Buffer.from(plain).toString('utf8'))
}

export const randomToken = (size = 32): string => base64url.encode(bytes(Crypto.randomBytes(size)))
