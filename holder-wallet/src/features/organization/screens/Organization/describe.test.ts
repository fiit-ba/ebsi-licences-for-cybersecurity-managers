// A refusal after a TI's accreditation ended (design decisions D23) is said with its
// date, and never as an expired offer or certificate.

jest.mock('i18next', () => ({
  addResourceBundle: jest.fn(),
  getFixedT: () => (key: string) => key,
  t: (key: string, options: Record<string, unknown> = {}) => `${key}|${options.date ?? ''}`,
}))
jest.mock('@app/localization/Language', () => ({
  inLanguage: (texts: Record<string, string>) => texts.sk,
  currentLanguage: () => 'sk',
}))

import { OrganizationError } from '@infrastructure/organization/OrganizationService'
import { describeOrganizationError } from '@features/organization/screens/Organization/describe'

describe('describeOrganizationError', () => {
  it('names the day the accreditation ended', () => {
    const error = new OrganizationError('ERROR_ACCREDITATION_EXPIRED', { until: '2027-10-13T12:00:00Z' })
    expect(describeOrganizationError(error)).toBe('ERROR_ACCREDITATION_EXPIRED|13. 10. 2027')
  })

  it('says a revocation with its date, and whose it was (D24)', () => {
    const own = new OrganizationError('ERROR_ACCREDITATION_REVOKED', { until: '2026-10-13T12:00:00Z' })
    expect(describeOrganizationError(own)).toBe('ERROR_ACCREDITATION_REVOKED|13. 10. 2026')
    const tao = new OrganizationError('ERROR_ACCREDITATION_REVOKED', { until: '2026-10-13T12:00:00Z', byTao: true })
    expect(describeOrganizationError(tao)).toBe('ERROR_ACCREDITATION_REVOKED_TAO|13. 10. 2026')
  })

  it('says it without a date when the registry gave none', () => {
    expect(describeOrganizationError(new OrganizationError('ERROR_ACCREDITATION_EXPIRED'))).toBe(
      'ERROR_ACCREDITATION_EXPIRED_UNDATED|',
    )
  })
})
