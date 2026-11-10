// A certificate whose attributes its holder discloses one by one
// (design decisions D36): what the wallet keeps, what it shows its holder, and
// what it hands a verifier.
import { base64url } from 'jose'
import { claimsOf, digestOf, optionalAttributes, reveal, split, withDisclosed } from './sdJwt'

const disclosure = (name: string, value: unknown) => base64url.encode(JSON.stringify([`salt-${name}`, name, value]))
const b64 = (value: object) => base64url.encode(JSON.stringify(value))

const DISCLOSURES = [disclosure('holderName', 'Ján Novák'), disclosure('trainingDays', 5)]
const PAYLOAD = {
  iss: 'did:ebsi:zTi',
  _sd_alg: 'sha-256',
  vc: {
    issuer: 'did:ebsi:zTi',
    credentialSubject: { id: 'did:key:z', certificateNumber: 'SK-1', _sd: DISCLOSURES.map(digestOf).sort() },
  },
}
const TOKEN = `${b64({ alg: 'ES256' })}.${b64(PAYLOAD)}.c2ln~${DISCLOSURES.join('~')}~`

describe('a selectively disclosed certificate', () => {
  it('shows its holder every attribute', () => {
    expect(claimsOf(TOKEN).vc.credentialSubject).toEqual({
      id: 'did:key:z',
      certificateNumber: 'SK-1',
      holderName: 'Ján Novák',
      trainingDays: 5,
    })
    expect(claimsOf(TOKEN)._sd_alg).toBeUndefined()
  })

  it('names the attributes its holder may keep to themselves', () => {
    expect(optionalAttributes(TOKEN)).toEqual(['holderName', 'trainingDays'])
  })

  it('goes to a verifier with only the chosen disclosures', () => {
    const shown = withDisclosed(TOKEN, ['trainingDays'])
    expect(split(shown).disclosures).toEqual([DISCLOSURES[1]])
    expect(claimsOf(shown).vc.credentialSubject).toEqual({
      id: 'did:key:z',
      certificateNumber: 'SK-1',
      trainingDays: 5,
    })
    expect(claimsOf(withDisclosed(TOKEN, [])).vc.credentialSubject).toEqual({
      id: 'did:key:z',
      certificateNumber: 'SK-1',
    })
  })

  it('refuses a disclosure that matches no digest, or comes twice', () => {
    expect(() => reveal(PAYLOAD, [disclosure('holderName', 'Someone Else')])).toThrow('ERROR_DISCLOSURES')
    expect(() => reveal(PAYLOAD, [DISCLOSURES[0], DISCLOSURES[0]])).toThrow('ERROR_DISCLOSURES')
    expect(() => split(`${TOKEN}kb.jwt.sig`)).toThrow('ERROR_DISCLOSURES')
  })

  it('reads a certificate signed as a whole as it always was', () => {
    const whole = `${b64({ alg: 'ES256' })}.${b64({ vc: { credentialSubject: { id: 'x', a: 1 } } })}.c2ln`
    expect(optionalAttributes(whole)).toEqual([])
    expect(withDisclosed(whole, ['a'])).toBe(whole)
    expect(claimsOf(whole).vc.credentialSubject).toEqual({ id: 'x', a: 1 })
  })
})
