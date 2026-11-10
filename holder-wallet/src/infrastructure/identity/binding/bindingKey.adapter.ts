import Crypto from 'react-native-quick-crypto'
import { ec as EC } from 'elliptic'
import { base64url } from 'jose'

export const p256 = new EC('p256')

export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string }

export const publicJwk = (key: EC.KeyPair): PublicJwk => {
  const point = key.getPublic()
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64url.encode(Uint8Array.from(point.getX().toArray('be', 32))),
    y: base64url.encode(Uint8Array.from(point.getY().toArray('be', 32))),
  }
}

/** A deterministic P-256 key derived for a domain-specific identity purpose. */
export const derivedKey = (secret: Buffer, salt: string, info: string, separator: string): EC.KeyPair => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const label = attempt ? `${info}${separator}${attempt}` : info
    const key = p256.keyFromPrivate(Buffer.from(Crypto.hkdfSync('sha256', secret as any, salt, label, 32) as any))
    const value = key.getPrivate()
    if (!value.isZero() && value.cmp(p256.n!) < 0) return key
  }
  throw new Error(`No P-256 key for ${info}`)
}
