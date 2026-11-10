// The verifier shows the TI that issued a certificate, judged at issuance
// (design decisions D23): an accreditation that ended since leaves it VALID.

import { render } from '@testing-library/react-native'
import Outcome from '@features/verification/screens/Verify/components/Outcome'
import { VerificationResult } from '@infrastructure/verifier/verifier.types'

const result = (certificationBody: Record<string, unknown> | null): VerificationResult => ({
  status: 'done',
  outcome: 'VALID',
  verified: true,
  credential_types: ['VerifiableCredential', 'CybersecurityManagerCertificate'],
  checks: {},
  credentials: [
    {
      state: 'VALID',
      issuer: 'did:ebsi:zRegistry',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2028-10-01T00:00:00Z',
      checks: {},
      certification_body: certificationBody as any,
    },
  ],
  attributes_until: null,
  created_at: '2026-10-13T12:00:00Z',
})

describe('the certification body in the verifier', () => {
  it('says the TI was accredited when it issued, and that it has ended since', () => {
    const { getByText, queryByText } = render(
      <Outcome
        result={result({
          recorded: true,
          name: 'STU FIIT',
          issued_at: '2026-10-01T10:00:00Z',
          accredited_until_at_issuance: '2027-10-01T00:00:00Z',
          accredited_at_issuance: true,
          accredited_until: '2026-10-12T10:00:00Z',
          in_force_now: false,
        })}
      />,
    )
    expect(getByText('STATE_VALID')).toBeTruthy()
    expect(getByText('STU FIIT')).toBeTruthy()
    expect(getByText('ACCREDITED_AT_ISSUANCE_YES')).toBeTruthy()
    expect(getByText('ACCREDITATION_ENDED_SINCE')).toBeTruthy()
    expect(queryByText('ACCREDITED_AT_ISSUANCE_NO')).toBeNull()
  })

  it('says the TI was revoked since, and not that it merely ended (D24)', () => {
    const { getByText, queryByText } = render(
      <Outcome
        result={{
          ...result({
            recorded: true,
            name: 'STU FIIT',
            issued_at: '2026-10-01T10:00:00Z',
            accredited_until_at_issuance: '2027-10-01T00:00:00Z',
            accredited_at_issuance: true,
            accredited_until: '2027-10-01T00:00:00Z',
            in_force_now: false,
            revoked_at: '2026-10-13T10:00:00Z',
            revoked_organization: 'MIRRI',
            revoked_organization_kind: 'tao',
          }),
          outcome: 'REVOKED',
          verified: false,
        }}
      />,
    )
    expect(getByText('ACCREDITATION_REVOKED_TAO')).toBeTruthy()
    expect(queryByText('ACCREDITATION_ENDED_SINCE')).toBeNull()
  })

  it('says it is unknown for a certificate from before the TI was recorded', () => {
    const { getByText } = render(<Outcome result={result({ recorded: false })} />)
    expect(getByText('ACCREDITED_AT_ISSUANCE_UNKNOWN')).toBeTruthy()
  })

  it('shows nothing of a TI for a certificate from another issuer', () => {
    const { queryByText } = render(<Outcome result={result(null)} />)
    expect(queryByText('CERTIFICATION_BODY')).toBeNull()
  })
})
