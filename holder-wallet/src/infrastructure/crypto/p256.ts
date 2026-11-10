// The P-256 keys the wallet derives and checks itself (design decisions D31, D33,
// D34): the backup's signing key, the per-issuer binding keys, the exchange's
// ephemeral keys and the keys it verifies with. One curve, one way to write a
// key as a JWK, one way to read one back.
import Crypto from 'react-native-quick-crypto'
import { ec as EC } from 'elliptic'
import { base64url } from 'jose'
import { derivedKey, p256, publicJwk, type PublicJwk } from '@infrastructure/identity/binding/bindingKey.adapter'

export { derivedKey, p256, publicJwk, type PublicJwk }

export const sha256 = (data: string | Uint8Array): Uint8Array => {
  const hash = Crypto.createHash('sha256')
  hash.update(data as any)
  return Uint8Array.from(hash.digest() as any)
}

/** RFC 7638: the required members in order, no whitespace, SHA-256, base64url. */
export const thumbprint = (jwk: { crv: string; kty: string; x: string; y: string }): string =>
  base64url.encode(sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })))

const hexOf = (value: string) => Buffer.from(base64url.decode(value)).toString('hex')

/** A P-256 public key that is on the curve, or an error. */
export const publicKeyOf = (jwk: PublicJwk): EC.KeyPair => {
  if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('Not a P-256 public key')
  const key = p256.keyFromPublic({ x: hexOf(jwk.x), y: hexOf(jwk.y) } as any)
  if (!key.validate().result) throw new Error('The key is not on the curve')
  return key
}
