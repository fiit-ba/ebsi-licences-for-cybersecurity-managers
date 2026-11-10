// A certificate whose attributes its holder discloses one by one (design decisions
// D36). It stays the W3C JWT-VC EBSI issues, and EBSI's guideline on selective
// disclosure applies SD-JWT (RFC 9901) to it: the issuer signs, in place of
// each attribute the holder may keep to themselves, the digest of a
// disclosure - [salt, name, value], base64url-encoded - and hands the
// disclosures over after the JWT:
//     <issuer-signed JWT>~<disclosure>~<disclosure>~
// The wallet keeps them all. It presents the JWT with the ones the holder
// chooses, and a verifier sees those attributes and no others; what it always
// needs - the TI that issued the certificate, its schemas, validity, number
// and record on the governance contract - is signed in clear. No key-binding
// JWT follows: the JWT-VP the holder signs binds the certificate to them.
import { base64url } from 'jose'
import Crypto from 'react-native-quick-crypto'

export const SD_ALG = 'sha-256'

const decodeSegment = (segment: string) => JSON.parse(Buffer.from(base64url.decode(segment)).toString('utf8'))

const sha256 = (value: string): Uint8Array => {
  const hash = Crypto.createHash('sha256')
  hash.update(value)
  return Uint8Array.from(hash.digest() as Uint8Array)
}

/** What the issuer signs in place of a disclosure: base64url(SHA-256(it)). */
// A disclosure is base64url, so ASCII: hashing the string hashes its ASCII bytes.
export const digestOf = (disclosure: string): string => base64url.encode(sha256(disclosure))

/**
 * The issuer-signed JWT and the disclosures that came with it; a plain JWT has
 * none. A key-binding JWT after the last '~' is refused.
 */
export const split = (token: string): { jwt: string; disclosures: string[] } => {
  const [jwt, ...rest] = String(token ?? '')
    .trim()
    .split('~')
  if (rest.length && rest[rest.length - 1]) throw new Error('ERROR_DISCLOSURES')
  return { jwt, disclosures: rest.filter(Boolean) }
}

/** A disclosure's attribute name and value. */
export const disclosed = (disclosure: string): { name: string; value: unknown } => {
  let value: unknown
  try {
    value = decodeSegment(disclosure)
  } catch {
    throw new Error('ERROR_DISCLOSURES')
  }
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== 'string' || typeof value[1] !== 'string') {
    throw new Error('ERROR_DISCLOSURES')
  }
  if (['_sd', '...', '_sd_alg'].includes(value[1])) throw new Error('ERROR_DISCLOSURES')
  return { name: value[1], value: value[2] }
}

/**
 * The JWT's payload with the disclosed attributes in place of their digests.
 * Every disclosure must match a digest the issuer signed, once; the digests
 * nobody disclosed are dropped, and with them `_sd` and `_sd_alg`. Throws
 * ERROR_DISCLOSURES otherwise.
 */
export const reveal = <T extends Record<string, unknown>>(payload: T, disclosures: string[]): T => {
  if (disclosures.length && (payload?._sd_alg ?? SD_ALG) !== SD_ALG) throw new Error('ERROR_DISCLOSURES')
  const byDigest = new Map<string, { name: string; value: unknown }>()
  for (const disclosure of disclosures) {
    const key = digestOf(disclosure)
    if (byDigest.has(key)) throw new Error('ERROR_DISCLOSURES')
    byDigest.set(key, disclosed(disclosure))
  }
  const used = new Set<string>()
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      if (node.some((item) => item && typeof item === 'object' && '...' in item)) throw new Error('ERROR_DISCLOSURES')
      return node.map(walk)
    }
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (key !== '_sd' && key !== '_sd_alg') out[key] = walk(value)
    }
    const digests = (node as Record<string, unknown>)._sd ?? []
    if (!Array.isArray(digests)) throw new Error('ERROR_DISCLOSURES')
    for (const key of digests) {
      const found = byDigest.get(key)
      if (!found) continue
      if (used.has(key) || found.name in out) throw new Error('ERROR_DISCLOSURES')
      used.add(key)
      out[found.name] = walk(found.value)
    }
    return out
  }
  const revealed = walk(payload) as T
  if (used.size !== byDigest.size) throw new Error('ERROR_DISCLOSURES')
  return revealed
}

/** The payload of a certificate as its holder sees it, every attribute revealed. Unverified. */
export type CredentialClaims = Record<string, unknown> & {
  vc: Record<string, unknown> & { credentialSubject: Record<string, unknown> }
}

export const claimsOf = (token: string): CredentialClaims => {
  const { jwt, disclosures } = split(token)
  return reveal(decodeSegment(jwt.split('.')[1]), disclosures) as CredentialClaims
}

/** The attributes a certificate lets its holder keep to themselves, by name. */
export const optionalAttributes = (token: string): string[] => {
  const { disclosures } = split(token)
  return disclosures.map((disclosure) => disclosed(disclosure).name)
}

/** The certificate with only the disclosures of `names`, as the holder presents it. */
export const withDisclosed = (token: string, names: string[]): string => {
  const { jwt, disclosures } = split(token)
  if (!disclosures.length) return jwt
  const kept = disclosures.filter((disclosure) => names.includes(disclosed(disclosure).name))
  return `${jwt}~${kept.map((disclosure) => `${disclosure}~`).join('')}`
}
