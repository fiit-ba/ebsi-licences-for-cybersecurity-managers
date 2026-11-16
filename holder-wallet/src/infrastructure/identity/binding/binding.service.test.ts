// What a certificate is bound to (design decisions D34): a binding key per issuer,
// from the identity key alone, and never the wallet's own DID.
import { SignJWT, importJWK } from 'jose'
import { ec as EC } from 'elliptic'
import { Resolver } from 'did-resolver'
import { getResolver, util as keyDid } from '@cef-ebsi/key-did-resolver'
import { binding, bindingKey, bindingOfCredentials } from './binding.service'
import { publicJwk } from './bindingKey.adapter'

const IDENTITY = '0x' + '4c'.repeat(32)
const REGISTRY = 'http://192.168.1.11:8000'
const CONFORMANCE = 'https://api-conformance.ebsi.eu/conformance/v3/issuer-mock'

const mockStored: { credential: string; issuerUri?: string }[] = []
jest.mock('@infrastructure/persistence/keychain', () => ({
  getPrivateKey: async () => '0x' + '4c'.repeat(32),
  getCredentialsList: async () => mockStored,
}))

const walletDid = () => keyDid.createDid(publicJwk(new EC('p256').keyFromPrivate(IDENTITY.slice(2), 'hex')) as any)

/** A certificate bound to `subject`, as an issuer signs it. */
const certificate = async (subject: string) => {
  const issuer = new EC('p256').genKeyPair()
  const jwk = { ...publicJwk(issuer), d: Buffer.from(issuer.getPrivate().toArray('be', 32)).toString('base64url') }
  return new SignJWT({ vc: { credentialSubject: { id: subject } }, sub: subject })
    .setProtectedHeader({ alg: 'ES256', kid: 'did:ebsi:zTi#k' })
    .sign(await importJWK(jwk as any, 'ES256'))
}

describe('what a certificate is bound to', () => {
  it('is the same for the same phrase and issuer, on any phone', () => {
    expect(binding(IDENTITY, REGISTRY)).toEqual(binding(IDENTITY, REGISTRY + '/'))
  })

  it("is another for every issuer, and never the wallet's own DID", () => {
    const registry = binding(IDENTITY, REGISTRY).did
    const conformance = binding(IDENTITY, CONFORMANCE).did
    expect(registry).not.toBe(conformance)
    expect([registry, conformance]).not.toContain(walletDid())
  })

  it("is EBSI's did:key for natural persons, of the key the wallet signs with", async () => {
    const { did } = binding(IDENTITY, REGISTRY)
    const { didDocument } = await new Resolver(getResolver()).resolve(did)
    expect(didDocument?.verificationMethod?.[0]?.publicKeyJwk).toEqual(publicJwk(bindingKey(IDENTITY, REGISTRY)))
  })

  it('signs a presentation of certificates bound to it', async () => {
    const own = binding(IDENTITY, REGISTRY)
    const held = await certificate(own.did)
    mockStored.splice(0, mockStored.length, { credential: held, issuerUri: REGISTRY })
    expect(await bindingOfCredentials([held])).toEqual(own)
  })

  it('signs a presentation of a certificate shown with fewer disclosures than it is kept with (D36)', async () => {
    const own = binding(IDENTITY, REGISTRY)
    const held = `${await certificate(own.did)}~WyJzIiwiYSIsMV0~WyJzIiwiYiIsMl0~`
    mockStored.splice(0, mockStored.length, { credential: held, issuerUri: REGISTRY })
    expect(await bindingOfCredentials([`${held.split('~')[0]}~WyJzIiwiYSIsMV0~`])).toEqual(own)
  })

  it("does not present a certificate bound to the wallet's own DID", async () => {
    const held = await certificate(walletDid())
    mockStored.splice(0, mockStored.length, { credential: held })
    await expect(bindingOfCredentials([held])).rejects.toThrow('ERROR_NOT_ISSUER_DID')
  })

  it('does not present certificates of different issuers together', async () => {
    const a = await certificate(binding(IDENTITY, REGISTRY).did)
    const b = await certificate(binding(IDENTITY, CONFORMANCE).did)
    mockStored.splice(
      0,
      mockStored.length,
      { credential: a, issuerUri: REGISTRY },
      { credential: b, issuerUri: CONFORMANCE },
    )
    await expect(bindingOfCredentials([a, b])).rejects.toThrow('ERROR_SEVERAL_HOLDERS')
  })
})
