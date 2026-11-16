// Presenting from the holder's phone and verifying without the server
// (design decisions D33, D34, D36): the holder's exchange, the verifier's request
// over it, the holder's JWT-VP with the attributes they chose, and the
// verifier's own checks against EBSI's registries and the certificate's
// record on the ledger - here a fake of each, built from real keys and
// signatures.
import { SignJWT, base64url, exportJWK, generateKeyPair } from 'jose'
import { utils } from 'ethers'
import { util as keyDid } from '@cef-ebsi/key-did-resolver'
import { HolderExchange } from './session'
import { newEphemeralKey, open, publicJwk, seal } from './crypto'
import { DEFAULT_FIELDS, buildRequest, envelopePresentation, exchangeIdOf, parseInvitation, queryOf } from './protocol'
import { formatResponse, parseRequest } from './server'
import { askForPresentation, ExchangeDeclined } from './client'
import { rebase, verifyPresentation } from './verify'
import { signPresentation } from './presentation'
import { checkCertificateStatus } from '@infrastructure/openid/checkRevocation'
import { statusKeyOf } from '@infrastructure/ledger'
import { digestOf, withDisclosed } from '@domain/credentials/sdJwt'

jest.mock('@infrastructure/config/Ebsi', () => ({
  ebsi: {
    isConfigured: () => true,
    didRegistry: () => 'http://ebsi.test/v1/did-registry',
    trustedIssuersRegistry: () => 'http://ebsi.test/v1/issuers-registry',
    trustedSchemasRegistry: () => 'http://ebsi.test/v1/schemas-registry',
    ledger: () => 'http://ebsi.test/v1/ledger',
  },
  certificates: { registry: () => '0x' + 'cc'.repeat(20), chainId: () => 1337 },
  supportOfficeDid: () => 'did:ebsi:zSupportOffice',
}))

const CONTRACT = '0x' + 'cc'.repeat(20)
const TIR = 'http://anywhere.example/v1/issuers-registry'
const SCHEMA = 'http://anywhere.example/v1/schemas-registry/schemas/zCert'
const TYPES = ['VerifiableCredential', 'VerifiableAttestation', 'CybersecurityManagerCertificate']
const ATTRIBUTES: Record<string, unknown> = {
  certificateTitle: 'Manažér kybernetickej bezpečnosti',
  holderName: 'Ján Novák',
  certificateNumber: 'SK-CSM-1',
  certificationBody: 'STU FIIT',
  trainingDays: 5,
}

const fetchMock = jest.fn()
;(global as any).fetch = fetchMock

const json = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body })

/** One attribute as the issuer hands it over: [salt, name, value] (D36). */
const disclosureOf = (name: string, value: unknown) =>
  base64url.encode(JSON.stringify([base64url.encode(Uint8Array.from(Buffer.from(name + Math.random()))), name, value]))

const RECORD_ABI =
  'function certificateStatus(bytes32) view returns (tuple(uint8 standing, uint64 validFrom, uint64 validUntil, uint64 registeredAt, uint64 changedAt, bytes32 credentialHash, string issuerDid))'
const registry = new utils.Interface([RECORD_ABI])

/** The record the certificate registry keeps, as `certificateStatus` returns it. */
const recordOf = (
  standing: number,
  { hash, issuer, validFrom, validUntil }: { hash: string; issuer: string; validFrom: number; validUntil: number },
) =>
  registry.encodeFunctionResult('certificateStatus', [
    [standing, validFrom, validUntil, validFrom, validFrom, hash, issuer],
  ])

/** SHA-256 of a credential's signed JWT, as the registry records it. */
const hashOf = (credential: string) => utils.sha256(utils.toUtf8Bytes(credential.split('~')[0]))

/** An authority: a DID, its key, and its DID document as the DIDR serves it. */
const authority = async (did: string) => {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  const kid = `${did}#key-1`
  return {
    did,
    kid,
    privateKey,
    document: { id: did, verificationMethod: [{ id: kid, publicKeyJwk: jwk }], assertionMethod: [kid] },
  }
}

const accreditation = async (by: any, subject: string, types: string[], extra: Record<string, unknown> = {}) =>
  new SignJWT({
    vc: {
      type: ['VerifiableCredential', 'VerifiableAttestation', ...types],
      issuer: by.did,
      credentialSubject: { id: subject, ...extra },
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: by.kid })
    .setIssuer(by.did)
    .sign(by.privateKey)

/** A holder: an EBSI did:key for natural persons, and its private key as the wallet keeps it. */
const holder = async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = await exportJWK(privateKey)
  const did = keyDid.createDid({ kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! })
  return { did, privateKey: '0x' + Buffer.from(base64url.decode(jwk.d!)).toString('hex') }
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

type World = Awaited<ReturnType<typeof world>>

/** A registry: Support Office, RootTAO, TAO, TI, the TI's certificate of a holder, the ledger. */
const world = async ({
  standing = 1,
  exp = Math.floor(Date.now() / 1000) + 3600,
  tiType = 'TI',
  withTerms = true,
  termsAttribute = 'a-ti',
  contract = CONTRACT,
  omit = [] as string[],
  recorded = {} as Partial<{ hash: string; issuer: string; validFrom: number; validUntil: number }>,
} = {}) => {
  const [so, root, tao, ti] = await Promise.all(
    ['did:ebsi:zSupportOffice', 'did:ebsi:zRoot', 'did:ebsi:zTao', 'did:ebsi:zTi'].map(authority),
  )
  const scope = [{ schemaId: SCHEMA, types: TYPES }]
  const attributes: Record<string, any> = {
    [`${TIR}/issuers/${ti.did}/attributes/a-ti`]: {
      did: ti.did,
      attribute: {
        issuerType: tiType,
        body: await new SignJWT({
          vc: {
            type: ['VerifiableCredential', 'VerifiableAttestation', 'VerifiableAccreditationToAttest'],
            issuer: tao.did,
            credentialSubject: { id: ti.did, accreditedFor: scope },
            termsOfUse: { id: `${TIR}/issuers/${tao.did}/attributes/a-tao` },
          },
        })
          .setProtectedHeader({ alg: 'ES256', kid: tao.kid })
          .setIssuer(tao.did)
          .sign(tao.privateKey),
      },
    },
    [`${TIR}/issuers/${tao.did}/attributes/a-tao`]: {
      did: tao.did,
      attribute: {
        issuerType: 'TAO',
        body: await new SignJWT({
          vc: {
            type: ['VerifiableCredential', 'VerifiableAttestation', 'VerifiableAccreditationToAccredit'],
            issuer: root.did,
            credentialSubject: { id: tao.did, accreditedFor: scope },
            termsOfUse: { id: `${TIR}/issuers/${root.did}/attributes/a-root` },
          },
        })
          .setProtectedHeader({ alg: 'ES256', kid: root.kid })
          .setIssuer(root.did)
          .sign(root.privateKey),
      },
    },
    [`${TIR}/issuers/${root.did}/attributes/a-root`]: {
      did: root.did,
      attribute: {
        issuerType: 'RootTAO',
        body: await accreditation(so, root.did, ['VerifiableAuthorisationForTrustChain']),
      },
    },
    // The TI found by its DID, for a certificate without terms of use.
    [`${TIR}/issuers/${ti.did}`]: {
      did: ti.did,
      hasAttributes: true,
      attributes: `${TIR}/issuers/${ti.did}/attributes`,
    },
    [`${TIR}/issuers/${ti.did}/attributes`]: {
      items: [{ id: 'a-ti', href: `${TIR}/issuers/${ti.did}/attributes/a-ti` }],
    },
  }
  const wallet = await holder()
  const issued = Math.floor(Date.now() / 1000) - 60
  // The certificate as the issuer issues it: a W3C JWT-VC bound to the
  // holder's DID (D34), its attributes but the number as digests, their
  // disclosures after it (D36).
  const held = Object.fromEntries(Object.entries(ATTRIBUTES).filter(([name]) => !omit.includes(name)))
  const disclosures = Object.entries(held)
    .filter(([name]) => name !== 'certificateNumber')
    .map(([name, value]) => disclosureOf(name, value))
  const vc = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: 'urn:uuid:1',
    type: TYPES,
    issuer: ti.did,
    issuanceDate: iso(issued),
    validFrom: iso(issued),
    expirationDate: iso(exp),
    credentialSubject: {
      id: wallet.did,
      ...('certificateNumber' in held ? { certificateNumber: held.certificateNumber } : {}),
      _sd: disclosures.map(digestOf).sort(),
    },
    credentialSchema: [{ id: SCHEMA, type: 'FullJsonSchemaValidator2021' }],
    // The registry only: its key follows from the issuer and the id.
    credentialStatus: [{ id: `eip155:1337:${contract}`, type: 'PlrLedgerStatusEntry', chainId: 1337, contract }],
    ...(withTerms
      ? { termsOfUse: { id: `${TIR}/issuers/${ti.did}/attributes/${termsAttribute}`, type: 'IssuanceCertificate' } }
      : {}),
  }
  const signed = await new SignJWT({ vc, jti: vc.id, sub: wallet.did, nbf: issued, exp, _sd_alg: 'sha-256' })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: ti.kid })
    .setIssuer(ti.did)
    .setIssuedAt(issued)
    .sign(ti.privateKey)
  const credential = `${signed}~${disclosures.map((d) => `${d}~`).join('')}`
  const schema = {
    type: 'object',
    properties: {
      credentialSubject: { type: 'object', properties: { trainingDays: { type: 'integer' } }, required: ['id'] },
    },
    required: ['credentialSubject'],
  }
  const record = recordOf(standing, {
    hash: hashOf(signed),
    issuer: ti.did,
    validFrom: issued,
    validUntil: exp,
    ...recorded,
  })
  const documents = Object.fromEntries([so, root, tao, ti].map((a) => [a.did, a.document]))
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    const tirPrefix = 'http://ebsi.test/v1/issuers-registry'
    if (url.startsWith('http://ebsi.test/v1/did-registry/identifiers/')) {
      const did = decodeURIComponent(url.split('/identifiers/')[1].split('?')[0])
      return json(documents[did] ? 200 : 404, documents[did] ?? {})
    }
    if (url.startsWith(tirPrefix)) {
      const found = attributes[decodeURIComponent(url).replace(tirPrefix, TIR)]
      return json(found ? 200 : 404, found ?? {})
    }
    if (url === 'http://ebsi.test/v1/schemas-registry/schemas/zCert') return json(200, schema)
    if (url === 'http://ebsi.test/v1/ledger') {
      const call = JSON.parse(init.body)
      expect(call.params[0].to).toBe(CONTRACT)
      // Under the key computed from the certificate's TI and id.
      expect(call.params[0].data).toBe(
        registry.encodeFunctionData('certificateStatus', [statusKeyOf(ti.did, 'urn:uuid:1')]),
      )
      return json(200, { jsonrpc: '2.0', id: 1, result: record })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  return { credential, wallet, ti, signed }
}

/**
 * The holder answers the request it received, as the Present screen does:
 * with what the verifier requires and `chosen` besides.
 */
const answer = async (exchange: HolderExchange, w: World, signer = w.wallet, chosen: string[] = []) => {
  const query = exchange.query!
  exchange.answer(
    await signPresentation({
      did: signer.did,
      privateKey: signer.privateKey,
      credential: withDisclosed(w.credential, [...query.mandatory, ...chosen]),
      challenge: query.challenge,
      domain: query.domain,
    }),
  )
}

const auth = (exchange: HolderExchange) => ({ authorization: `Bearer ${exchange.token}` })

describe("the holder's exchange", () => {
  it('takes one encrypted request and gives one encrypted answer, to the token holder only', () => {
    const exchange = new HolderExchange('http://192.168.1.50:8765')
    const path = `/exchanges/${exchange.id}`
    const invitation = parseInvitation(JSON.stringify(exchange.invitation))!
    expect(exchangeIdOf(invitation.url)).toBe(exchange.id)

    const verifier = newEphemeralKey()
    const request = buildRequest(
      ['CybersecurityManagerCertificate'],
      DEFAULT_FIELDS,
      'c'.repeat(32),
      'urn:plr:verifier:x',
      'Firma',
    )
    const envelope = seal(
      verifier,
      invitation.key,
      exchange.id,
      'request',
      { verifiablePresentationRequest: request },
      true,
    )
    expect(exchange.handle('POST', path, {}, JSON.stringify({ envelope })).status).toBe(401)
    expect(exchange.handle('POST', path, auth(exchange), JSON.stringify({ envelope })).status).toBe(202)
    expect(exchange.query?.mandatory).toEqual(DEFAULT_FIELDS.mandatory)
    expect(exchange.query?.verifierName).toBe('Firma')
    expect(exchange.handle('POST', path, auth(exchange), JSON.stringify({ envelope })).status).toBe(409)
    expect(exchange.handle('GET', path, auth(exchange), '').status).toBe(202)

    exchange.answer(envelopePresentation('h.p.s'))
    const delivered = exchange.handle('GET', path, auth(exchange), '')
    expect(delivered.status).toBe(200)
    const opened = open(verifier, invitation.key, exchange.id, 'response', delivered.body.envelope as any)
    expect(opened.verifiablePresentation).toEqual({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiablePresentation',
      id: 'data:application/jwt,h.p.s',
    })
    // Delivered once, and the exchange is over.
    expect(exchange.handle('GET', path, auth(exchange), '').status).toBe(410)
  })

  it('closes after a few wrong tokens, and when its time runs out', () => {
    const exchange = new HolderExchange('http://h:1')
    for (let i = 0; i < 5; i++)
      exchange.handle('GET', `/exchanges/${exchange.id}`, { authorization: 'Bearer nope' }, '')
    expect(exchange.state).toBe('closed')
    let now = 0
    const late = new HolderExchange('http://h:1', {}, 1000, () => now)
    now = 2000
    expect(late.handle('GET', `/exchanges/${late.id}`, auth(late), '').status).toBe(410)
  })

  it("gives the holder the decision window once a request came, not the QR code's time", () => {
    let now = 0
    const exchange = new HolderExchange('http://h:1', {}, 1000, () => now, 10000)
    const request = buildRequest(
      ['CybersecurityManagerCertificate'],
      DEFAULT_FIELDS,
      'c'.repeat(32),
      'urn:plr:verifier:v',
    )
    const envelope = seal(
      newEphemeralKey(),
      exchange.invitation.key,
      exchange.id,
      'request',
      { verifiablePresentationRequest: request },
      true,
    )
    now = 500
    expect(
      exchange.handle('POST', `/exchanges/${exchange.id}`, auth(exchange), JSON.stringify({ envelope })).status,
    ).toBe(202)
    now = 8000
    expect(exchange.handle('GET', `/exchanges/${exchange.id}`, auth(exchange), '').status).toBe(202)
    now = 11000
    expect(exchange.handle('GET', `/exchanges/${exchange.id}`, auth(exchange), '').status).toBe(410)
  })

  it('refuses a request it cannot open', () => {
    const exchange = new HolderExchange('http://h:1')
    const stranger = newEphemeralKey()
    const envelope = seal(stranger, publicJwk(newEphemeralKey()), exchange.id, 'request', {}, true)
    expect(
      exchange.handle('POST', `/exchanges/${exchange.id}`, auth(exchange), JSON.stringify({ envelope })).status,
    ).toBe(400)
  })

  it('reads a request line, headers and body, once all of it is there', () => {
    const raw = Buffer.from('POST /exchanges/x HTTP/1.1\r\nAuthorization: Bearer t\r\nContent-Length: 2\r\n\r\n{}')
    expect(parseRequest(raw.subarray(0, raw.length - 1))).toBeNull()
    expect(parseRequest(raw)).toEqual({
      method: 'POST',
      path: '/exchanges/x',
      headers: { authorization: 'Bearer t', 'content-length': '2' },
      body: '{}',
    })
    expect(formatResponse({ status: 202, body: { status: 'pending' } })).toMatch(
      /^HTTP\/1\.1 202 Accepted\r\n[\s\S]*\r\n\r\n\{"status":"pending"\}$/,
    )
  })

  it('asks for at least a challenge and a type', () => {
    expect(() => queryOf({ query: [], challenge: 'c'.repeat(32), domain: 'd' } as any)).toThrow()
    expect(() => queryOf(buildRequest(['T'], DEFAULT_FIELDS, 'short', 'd'))).toThrow()
  })
})

describe('verifying without the server', () => {
  const ask = async (w: World, signer = w.wallet, chosen: string[] = []) => {
    const request = buildRequest(
      ['CybersecurityManagerCertificate'],
      DEFAULT_FIELDS,
      'c'.repeat(32),
      'urn:plr:verifier:v',
    )
    const exchange = new HolderExchange('http://h:1')
    const verifier = newEphemeralKey()
    const envelope = seal(
      verifier,
      exchange.invitation.key,
      exchange.id,
      'request',
      { verifiablePresentationRequest: request },
      true,
    )
    exchange.handle('POST', `/exchanges/${exchange.id}`, auth(exchange), JSON.stringify({ envelope }))
    await answer(exchange, w, signer, chosen)
    const delivered = exchange.handle('GET', `/exchanges/${exchange.id}`, auth(exchange), '')
    const { verifiablePresentation } = open(
      verifier,
      exchange.invitation.key,
      exchange.id,
      'response',
      delivered.body.envelope as any,
    )
    return verifyPresentation(verifiablePresentation, {
      challenge: request.challenge,
      domain: request.domain,
      fields: DEFAULT_FIELDS,
    })
  }

  it("finds a valid certificate valid, from EBSI's registries and the ledger alone", async () => {
    const w = await world()
    const result = await ask(w)
    expect(result.outcome).toBe('VALID')
    expect(result.credentials[0].trust_chain?.map((link) => link.role)).toEqual(['TI', 'TAO', 'RootTAO'])
    expect(result.checks).toMatchObject({
      presentation_valid: true,
      signature_valid: true,
      holder_bound: true,
      issuer_accredited: true,
      schemas_valid: true,
      disclosures_valid: true,
      status_available: true,
      record_matches: true,
      standing_valid: true,
    })
    expect(result.credentials[0].ledger).toMatchObject({ standing: 'valid', certificate_number: 'SK-CSM-1' })
  })

  it('receives what the verifier requires and what the holder chose, and nothing else (D36)', async () => {
    const required = Object.fromEntries(
      DEFAULT_FIELDS.mandatory.filter((name) => name in ATTRIBUTES).map((name) => [name, ATTRIBUTES[name]]),
    )
    expect((await ask(await world())).credentials[0].attributes).toEqual(required)
    const result = await ask(await world(), undefined, ['trainingDays'])
    expect(result.credentials[0].attributes).toEqual({ ...required, trainingDays: 5 })
    expect(result.outcome).toBe('VALID')
  })

  it('refuses an attribute the issuer did not sign', async () => {
    const w = await world()
    const presented = await signPresentation({
      did: w.wallet.did,
      privateKey: w.wallet.privateKey,
      credential: `${w.signed}~${disclosureOf('holderName', 'Someone Else')}~`,
      challenge: 'c'.repeat(32),
      domain: 'urn:plr:verifier:v',
    })
    const result = await verifyPresentation(presented, {
      challenge: 'c'.repeat(32),
      domain: 'urn:plr:verifier:v',
      fields: DEFAULT_FIELDS,
    })
    expect(result.checks.disclosures_valid).toBe(false)
    expect(result.outcome).toBe('INVALID_SIGNATURE')
  })

  it('does not judge a certificate by a record that is not its own', async () => {
    for (const recorded of [{ hash: '0x' + '22'.repeat(32) }, { validUntil: 0 }, { issuer: 'did:ebsi:zOther' }]) {
      const result = await ask(await world({ recorded }))
      expect(result.checks.record_matches).toBe(false)
      expect(result.outcome).toBe('INDETERMINATE')
    }
  })

  it('finds the issuer in the TIR by its DID when the certificate names no terms of use', async () => {
    const w = await world({ withTerms: false })
    const result = await ask(w)
    expect(result.outcome).toBe('VALID')
    expect(result.credentials[0].trust_chain?.map((link) => link.role)).toEqual(['TI', 'TAO', 'RootTAO'])
  })

  it('finds the issuer by its DID when the TIR no longer has the attribute its terms of use name', async () => {
    const w = await world({ termsAttribute: 'gone' })
    const result = await ask(w)
    expect(result.outcome).toBe('VALID')
    expect(result.checks.issuer_accredited).toBe(true)
  })

  it('reads suspended and revoked alike: not valid', async () => {
    for (const standing of [2, 3]) {
      const w = await world({ standing })
      expect((await ask(w)).outcome).toBe('INVALID')
    }
  })

  it('says expired after its date, whatever its standing', async () => {
    const w = await world({ standing: 2, exp: Math.floor(Date.now() / 1000) - 10 })
    expect((await ask(w)).outcome).toBe('EXPIRED')
  })

  it('does not trust an issuer whose accreditation is revoked in the TIR', async () => {
    const w = await world({ tiType: 'Revoked' })
    const result = await ask(w)
    expect(result.outcome).toBe('UNTRUSTED_ISSUER')
    expect(result.credentials[0].reason).toBe('revoked')
  })

  it("cannot decide, rather than distrusting the issuer, when EBSI's registries are unreachable", async () => {
    const w = await world()
    // The verifier's phone away from any network that reaches EBSI.
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Network request failed')
    })
    const result = await ask(w)
    expect(result.checks).toMatchObject({
      presentation_valid: true,
      holder_bound: true,
      signature_valid: null,
      issuer_accredited: null,
      status_available: false,
    })
    expect(result.outcome).toBe('INDETERMINATE')
  })

  it('cannot decide a certificate whose record is on a contract it does not trust', async () => {
    const w = await world({ contract: '0x' + 'dd'.repeat(20) })
    const result = await ask(w)
    expect(result.checks.status_available).toBe(false)
    expect(result.outcome).toBe('STATUS_UNAVAILABLE')
  })

  it('notices required data the certificate does not have', async () => {
    const w = await world({ omit: ['certificationBody'] })
    const result = await ask(w)
    expect(result.missingFields).toEqual(['certificationBody'])
    expect(result.outcome).toBe('INDETERMINATE')
  })

  it("refuses a presentation made for another verifier's challenge", async () => {
    const w = await world()
    const presented = await signPresentation({
      did: w.wallet.did,
      privateKey: w.wallet.privateKey,
      credential: withDisclosed(w.credential, DEFAULT_FIELDS.mandatory),
      challenge: 'other'.repeat(8),
      domain: 'urn:plr:verifier:v',
    })
    const result = await verifyPresentation(presented, {
      challenge: 'c'.repeat(32),
      domain: 'urn:plr:verifier:v',
      fields: DEFAULT_FIELDS,
    })
    expect(result.checks.presentation_valid).toBe(false)
    expect(result.outcome).toBe('INDETERMINATE')
  })

  it("refuses someone else's certificate, presented by a DID it was not issued to", async () => {
    const w = await world()
    const result = await ask(w, await holder())
    expect(result.checks.holder_bound).toBe(false)
    expect(result.outcome).toBe('INDETERMINATE')
  })

  it('refuses a presentation not signed by the DID it names', async () => {
    const w = await world()
    const other = await holder()
    const result = await ask(w, { did: w.wallet.did, privateKey: other.privateKey })
    expect(result.checks.presentation_valid).toBe(false)
    expect(result.outcome).toBe('INDETERMINATE')
  })

  it('follows a URL the certificate names only within the configured registry', () => {
    expect(
      rebase(`${TIR}/issuers/x/attributes/y`, 'http://ebsi.test/v1/issuers-registry', '/v1/issuers-registry/'),
    ).toBe('http://ebsi.test/v1/issuers-registry/issuers/x/attributes/y')
    expect(() =>
      rebase('http://evil.example/x', 'http://ebsi.test/v1/issuers-registry', '/v1/issuers-registry/'),
    ).toThrow()
  })
})

describe("the holder's own view of a certificate", () => {
  const FROM = 1767225600
  const vcOf = (contract = CONTRACT) => ({
    id: 'urn:uuid:1',
    issuer: 'did:ebsi:zTi',
    validFrom: iso(FROM),
    credentialSubject: { id: 'did:key:z', certificateNumber: 'SK-CSM-1' },
    credentialStatus: [{ id: 'x', type: 'PlrLedgerStatusEntry', chainId: 1337, contract }],
  })
  // The credential whose hash the record keeps; any JWT will do for the holder's own view.
  const CREDENTIAL = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln~disclosure~'
  const ledger = (standing: number | 'down', hash = hashOf(CREDENTIAL)) =>
    fetchMock.mockImplementation(async () => {
      if (standing === 'down') throw new Error('offline')
      return json(200, {
        result: recordOf(standing, { hash, issuer: 'did:ebsi:zTi', validFrom: FROM, validUntil: 0 }),
      })
    })
  const check = (vc = vcOf()) => checkCertificateStatus(vc, undefined, undefined, CREDENTIAL)

  it("is the registry's record", async () => {
    ledger(1)
    expect(await check()).toEqual({ valid: true, state: 'valid' })
    ledger(2)
    expect(await check()).toEqual({ valid: false, state: 'suspended' })
    ledger(3)
    expect(await check()).toEqual({ valid: false, state: 'revoked' })
  })

  it('is not known when the ledger cannot be read: there is nothing to fall back on', async () => {
    ledger('down')
    expect((await check()).state).toBe('unknown')
    ledger(1)
    expect((await check(vcOf('0x' + 'dd'.repeat(20)))).state).toBe('unknown')
  })

  it("is not known from a record that is not the certificate's own", async () => {
    ledger(3, '0x' + '22'.repeat(32))
    expect((await check()).state).toBe('unknown')
  })
})

describe("the verifier's request over HTTP", () => {
  it('is told when the holder declines', async () => {
    const exchange = new HolderExchange('http://h:1')
    const calls: string[] = []
    fetchMock.mockImplementation(async (url: string, init: any = {}) => {
      const answerOf = exchange.handle(
        init.method ?? 'GET',
        new URL(url).pathname,
        { authorization: init.headers.Authorization },
        init.body ?? '',
      )
      calls.push(`${init.method ?? 'GET'} ${answerOf.status}`)
      if (calls.length === 1) exchange.decline()
      return { status: answerOf.status, ok: answerOf.status < 400, json: async () => answerOf.body }
    })
    jest.useFakeTimers()
    const asked = askForPresentation(exchange.invitation, ['CybersecurityManagerCertificate'], DEFAULT_FIELDS)
    const outcome = expect(asked).rejects.toBeInstanceOf(ExchangeDeclined)
    await jest.advanceTimersByTimeAsync(1500)
    await outcome
    expect(calls).toEqual(['POST 202', 'GET 403'])
  })
})
