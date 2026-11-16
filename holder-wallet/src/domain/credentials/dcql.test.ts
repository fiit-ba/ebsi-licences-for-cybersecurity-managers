// What a verifier asks for with OpenID4VP 1.0 (a DCQL query), matched against a
// certificate the wallet holds: the combinations of claims it can present, and
// the attributes each discloses.
import { base64url } from 'jose'
import { digestOf } from './sdJwt'
import { answers, assignQueries, claimOptions, DcqlCredentialQuery } from './dcql'

const disclosure = (name: string, value: unknown) => base64url.encode(JSON.stringify([`salt-${name}`, name, value]))
const b64 = (value: object) => base64url.encode(JSON.stringify(value))
const TYPE = 'CybersecurityManagerCertificate'

const certificate = (attributes: Record<string, unknown>, types = ['VerifiableCredential', TYPE]) => {
  const disclosures = Object.entries(attributes).map(([name, value]) => disclosure(name, value))
  const payload = {
    _sd_alg: 'sha-256',
    vc: {
      type: types,
      issuer: 'did:ebsi:zTi',
      credentialSubject: { id: 'did:key:z', certificateNumber: 'SK-1', _sd: disclosures.map(digestOf).sort() },
    },
  }
  return `${b64({ alg: 'ES256' })}.${b64(payload)}.c2ln~${disclosures.join('~')}~`
}

const claim = (name: string) => ({ id: name, path: ['credentialSubject', name] })
const MANDATORY = ['certificateTitle', 'holderName', 'certificateNumber', 'certificationBody']
const ALL = [...MANDATORY, 'jobPosition', 'funding']
const QUERY: DcqlCredentialQuery = {
  id: 'certificate',
  format: 'jwt_vc_json',
  meta: { type_values: [[TYPE]] },
  claims: ALL.map(claim),
  claim_sets: [ALL, MANDATORY],
}
const FULL = { certificateTitle: 'Manažér KB', holderName: 'Ján Novák', certificationBody: 'STU FIIT' }

describe('a DCQL query, against a certificate', () => {
  it('offers every claim set the certificate satisfies, the verifier’s preferred first', () => {
    const token = certificate({ ...FULL, jobPosition: 'CISO', funding: 'PO' })
    const options = claimOptions(QUERY, token)
    expect(options.map((option) => option.ids)).toEqual([ALL, MANDATORY])
    // The number is signed in clear: there is nothing to disclose for it.
    expect(options[0].names).toEqual(['certificateTitle', 'holderName', 'certificationBody', 'jobPosition', 'funding'])
    expect(options[1].names).toEqual(['certificateTitle', 'holderName', 'certificationBody'])
  })

  it('offers only the sets whose every claim the certificate has', () => {
    const token = certificate({ ...FULL, jobPosition: 'CISO' })
    expect(claimOptions(QUERY, token).map((option) => option.ids)).toEqual([MANDATORY])
    expect(claimOptions(QUERY, certificate({ holderName: 'Ján Novák' }))).toEqual([])
  })

  it('does not answer a query for another type or format', () => {
    const token = certificate(FULL)
    expect(answers({ ...QUERY, meta: { type_values: [['OtherCertificate']] } }, token)).toBe(false)
    expect(answers({ ...QUERY, format: 'dc+sd-jwt' }, token)).toBe(false)
    expect(answers(QUERY, token)).toBe(true)
  })

  it('asks for every listed claim without claim sets, and for nothing to disclose without claims', () => {
    const token = certificate({ ...FULL, jobPosition: 'CISO' })
    const { claim_sets: _sets, ...withoutSets } = QUERY
    expect(claimOptions({ ...withoutSets, claims: MANDATORY.map(claim) }, token)).toEqual([
      { ids: MANDATORY, names: ['certificateTitle', 'holderName', 'certificationBody'] },
    ])
    expect(claimOptions({ id: 'q', format: 'jwt_vc_json' }, token)).toEqual([{ ids: [], names: [] }])
  })

  it('assigns each chosen certificate to a query it answers, every query once', () => {
    const token = certificate(FULL)
    expect(assignQueries([QUERY], [{ id: 'a', token }])).toEqual({ certificate: 'a' })
    expect(assignQueries([QUERY], [])).toBeUndefined()
    expect(assignQueries([QUERY], [{ id: 'a', token: certificate(FULL, ['VerifiableCredential']) }])).toBeUndefined()
  })
})
