// What a certificate is bound to (design decisions D34). The holder has one DID,
// the wallet's, derived from the recovery phrase, and it never leaves the
// phone (D31). EBSI's issuance binds a certificate to a DID the issuer writes
// into it, so the wallet gives each issuer a binding key of its own instead:
// an EBSI did:key derived from the identity key and the issuer's identifier,
// nothing else. It is no identity of the holder's: the wallet does not show
// it, and HKDF is one-way, so it leads neither to the wallet's DID nor to the
// binding key used with another issuer. One per issuer, because EBSI's
// conformance tests follow a wallet by the DID it uses with their issuer, and
// end by asking for one presentation of all the certificates they issued it.
// The same phrase gives the same keys on any phone, so a restored wallet
// presents its certificates again.
import { ec as EC } from 'elliptic'
import { decodeJwt } from 'jose'
import { util as keyDid } from '@cef-ebsi/key-did-resolver'
import { derivedKey, publicJwk } from './bindingKey.adapter'
import { split } from '@domain/credentials/sdJwt'
import { getCredentialsList, getPrivateKey } from '@infrastructure/persistence/keychain'

const SALT = 'PLR-ISSUER-DID-V1'

export type Binding = { did: string; privateKey: string }

/** An issuer as the derivation names it: its OID4VCI identifier, without a trailing slash. */
export const issuerLabel = (issuer: string): string =>
  String(issuer ?? '')
    .trim()
    .replace(/\/+$/, '')

/** The binding key this wallet uses with `issuer`. */
export const bindingKey = (identityPrivateKeyHex: string, issuer: string): EC.KeyPair => {
  const label = issuerLabel(issuer)
  if (!label) throw new Error('No issuer to bind a certificate to')
  const identity = Buffer.from(String(identityPrivateKeyHex).replace(/^0x/, ''), 'hex')
  return derivedKey(identity, SALT, label, '#')
}

/** The binding key with `issuer` as EBSI's did:key for natural persons, and its private key. */
export const binding = (identityPrivateKeyHex: string, issuer: string): Binding => {
  const key = bindingKey(identityPrivateKeyHex, issuer)
  return { did: keyDid.createDid(publicJwk(key) as any), privateKey: '0x' + key.getPrivate().toString(16, 64) }
}

const unlockedIdentity = async (): Promise<string> => {
  const identity = await getPrivateKey()
  if (!identity) throw new Error('ERROR_NO_PRIVATE_KEY')
  return identity
}

/** The same, for the unlocked wallet. */
export const bindingForIssuer = async (issuer: string): Promise<Binding> => binding(await unlockedIdentity(), issuer)

/** The issuer-signed JWT: a certificate is presented with fewer disclosures than it is kept with (D36). */
const signedOf = (credential: string): string => split(String(credential)).jwt

const subjectOf = (credential: string): string => {
  const payload: any = decodeJwt(signedOf(credential))
  return String(payload?.vc?.credentialSubject?.id ?? payload?.sub ?? '')
}

/**
 * The binding to present certificates with: the one they are all bound to,
 * which must be the wallet's binding with the issuer it collected them from.
 * Certificates of different issuers are not presented together, and one bound
 * to anything else - the wallet's own DID among them - not at all.
 */
export const bindingOfCredentials = async (credentials: string[]): Promise<Binding> => {
  const subjects = new Set(credentials.map(subjectOf))
  if (subjects.size !== 1) throw new Error('ERROR_SEVERAL_HOLDERS')
  const [subject] = [...subjects]
  const identity = await unlockedIdentity()
  const stored = await getCredentialsList().catch(() => [])
  const presented = new Set(credentials.map(signedOf))
  const issuers = new Set(
    stored
      .filter((item) => presented.has(signedOf(item.credential as unknown as string)))
      .map((item) => item.issuerUri)
      .filter((issuer): issuer is string => Boolean(issuer)),
  )
  for (const issuer of issuers) {
    const candidate = binding(identity, issuer)
    if (candidate.did === subject) return candidate
  }
  throw new Error('ERROR_NOT_ISSUER_DID')
}
