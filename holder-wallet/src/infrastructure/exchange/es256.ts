// P-256 keys as JWKs, and ES256 signatures checked with them: the exchange's
// ephemeral keys (design decisions D33), and the verifier's checks of what a
// holder presents - its did:key's signature, the issuer's and those of the
// accreditations above it (D34).
import { base64url } from 'jose'
import { Resolver } from 'did-resolver'
import { getResolver as getKeyDidResolver } from '@cef-ebsi/key-did-resolver'
import { PublicJwk, publicJwk, publicKeyOf, sha256 } from '@infrastructure/crypto/p256'

export type { PublicJwk }
export { publicJwk }

/** Whether an ES256 JWS verifies with a P-256 public key. */
export const verifyEs256 = (jws: string, jwk: PublicJwk): boolean => {
  try {
    const [header, payload, signature] = String(jws).split('.')
    const raw = base64url.decode(signature)
    if (raw.length !== 64) return false
    const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
    return publicKeyOf(jwk).verify(Array.from(sha256(`${header}.${payload}`)), {
      r: toHex(raw.subarray(0, 32)),
      s: toHex(raw.subarray(32)),
    })
  } catch {
    return false
  }
}

const keyDids = new Resolver(getKeyDidResolver())

/**
 * The P-256 key of a holder's `did:key`, as EBSI defines it for natural
 * persons: the key is the identifier, so nothing is asked of any registry.
 * Null for anything else.
 */
export const didKeyJwk = async (did: string): Promise<PublicJwk | null> => {
  if (typeof did !== 'string' || !did.startsWith('did:key:')) return null
  try {
    const { didDocument } = await keyDids.resolve(did)
    const jwk = didDocument?.verificationMethod?.[0]?.publicKeyJwk as PublicJwk | undefined
    return jwk?.kty === 'EC' && jwk?.crv === 'P-256' && jwk.x && jwk.y
      ? { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
      : null
  } catch {
    return null
  }
}
