import { accreditationState } from '@domain/organization/organization'
import { hasResponseToken } from '@infrastructure/openid/openid.validator'
import { mapVerificationRequest } from '@infrastructure/verifier/verifier.mapper'
import { boolToString, stringToBool } from '@infrastructure/storage/storage.mapper'

describe('domain and infrastructure boundaries', () => {
  it('keeps storage boolean mapping unchanged', () => {
    expect(boolToString(true)).toBe('true')
    expect(stringToBool('TRUE')).toBe(true)
  })

  it('keeps the OpenID response token rule unchanged', () => {
    expect(hasResponseToken(undefined, 'id-token')).toBe(true)
    expect(hasResponseToken(undefined, undefined)).toBe(false)
  })

  it('maps the verifier wire response without changing its public shape', () => {
    expect(
      mapVerificationRequest({
        request_uri: 'openid://x',
        qr: 'data:image/png,x',
        state: 's',
        read_token: 'r',
        expires_at: 'e',
      }),
    ).toEqual({ requestUri: 'openid://x', qr: 'data:image/png,x', state: 's', readToken: 'r', expiresAt: 'e' })
  })

  it('keeps accreditation precedence in the domain', () => {
    expect(accreditationState(null, false)).toEqual({ kind: 'unlimited' })
    expect(accreditationState(null, false, 0, { at: null, byTao: true })).toEqual({
      kind: 'revoked',
      at: null,
      byTao: true,
    })
  })
})
