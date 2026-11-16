// An OpenID4VP 1.0 request is answered only once it verifies with a key of the
// DID its client identifier names, as EBSI's DID Registry lists it.
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { verifyRequestObject } from './requestObject'

jest.mock('@infrastructure/config/Ebsi', () => ({
  ebsi: { isConfigured: () => true, didRegistry: () => 'http://ebsi.test/v1/did-registry' },
}))

const fetchMock = jest.fn()
;(global as any).fetch = fetchMock

const DID = 'did:ebsi:zVerifier'
const KID = `${DID}#key-1`
const CLIENT = `decentralized_identifier:${DID}`
const REQUEST = {
  client_id: CLIENT,
  aud: 'https://self-issued.me/v2',
  response_type: 'vp_token',
  response_mode: 'direct_post',
  response_uri: 'http://verifier.test/auth/direct_post',
  nonce: 'n-1',
  state: 's-1',
  dcql_query: { credentials: [{ id: 'certificate', format: 'jwt_vc_json' }] },
}

const setup = async (relationship = 'assertionMethod') => {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const document = {
    id: DID,
    verificationMethod: [{ id: KID, type: 'JsonWebKey2020', publicKeyJwk: await exportJWK(publicKey) }],
    [relationship]: [KID],
  }
  fetchMock.mockImplementation(async (url: string) => ({
    ok: url === `http://ebsi.test/v1/did-registry/identifiers/${encodeURIComponent(DID)}`,
    status: 200,
    json: async () => document,
  }))
  const sign = (payload: object, header: object = {}) =>
    new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'ES256', typ: 'oauth-authz-req+jwt', kid: KID, ...header })
      .setExpirationTime('10m')
      .sign(privateKey)
  return { sign }
}

describe('a presentation request', () => {
  it("verifies with a key of the client's DID and is answered", async () => {
    const { sign } = await setup()
    await expect(verifyRequestObject(await sign(REQUEST), CLIENT)).resolves.toMatchObject({ nonce: 'n-1' })
  })

  it('is refused when signed with another key, or a key the DID does not list for that', async () => {
    const { sign } = await setup()
    const other = await generateKeyPair('ES256')
    const forged = await new SignJWT({ ...REQUEST })
      .setProtectedHeader({ alg: 'ES256', typ: 'oauth-authz-req+jwt', kid: KID })
      .sign(other.privateKey)
    await expect(verifyRequestObject(forged, CLIENT)).rejects.toThrow()
    await expect(verifyRequestObject(await sign(REQUEST), CLIENT)).resolves.toBeTruthy()
    const { sign: signUnlisted } = await setup('keyAgreement')
    await expect(verifyRequestObject(await signUnlisted(REQUEST), CLIENT)).rejects.toThrow()
  })

  it('is refused when it names another client, type or response', async () => {
    const { sign } = await setup()
    await expect(verifyRequestObject(await sign(REQUEST), 'decentralized_identifier:did:ebsi:zOther')).rejects.toThrow()
    await expect(verifyRequestObject(await sign(REQUEST, { typ: 'JWT' }), CLIENT)).rejects.toThrow()
    await expect(verifyRequestObject(await sign({ ...REQUEST, response_mode: 'fragment' }), CLIENT)).rejects.toThrow()
    await expect(
      verifyRequestObject(await sign({ ...REQUEST, dcql_query: undefined, presentation_definition: {} }), CLIENT),
    ).rejects.toThrow()
  })
})
