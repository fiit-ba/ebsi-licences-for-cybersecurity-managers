import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import CredentialList from '@features/presentations/components/RequestPresentationModal/components/CredentialList'
import { CredentialData } from '@infrastructure/openid/types'
// Keeps the fixtures focused on the selection contract exercised by this list.
const credential = (id: string, certificateNumber: string): CredentialData =>
  ({
    id,
    issuer: `did:ebsi:${id}`,
    validFrom: '2026-10-08',
    expirationDate: '2027-10-08',
    status: 'Active',
    credential: {
      header: { alg: 'ES256' },
      payload: {
        vc: {
          '@context': [],
          id,
          type: ['VerifiableCredential', 'CybersecurityManagerCertificate'],
          credentialSchema: { id: 'schema', type: 'JsonSchema' },
          credentialSubject: { id: 'holder', certificateNumber },
          issuanceDate: '2026-10-08',
          issuer: `did:ebsi:${id}`,
        },
      },
    },
  }) as CredentialData

describe('<CredentialList />', () => {
  const credentials = [credential('one', '101'), credential('two', '202'), credential('three', '303')]

  it('uses radio semantics and keeps exactly one certificate for one descriptor', () => {
    const onChange = jest.fn()
    const screen = render(
      <CredentialList credentials={credentials} requiredCount={1} onChangeSelectedCredentials={onChange} />,
    )

    const first = screen.getByLabelText(/101/)
    const second = screen.getByLabelText(/202/)
    expect(first.props.accessibilityRole).toBe('radio')

    fireEvent.press(first)
    expect(onChange).toHaveBeenLastCalledWith(['one'])
    fireEvent.press(second)
    expect(onChange).toHaveBeenLastCalledWith(['two'])
  })

  it('uses checkbox semantics and prevents selecting more credentials than requested', () => {
    const onChange = jest.fn()
    const screen = render(
      <CredentialList credentials={credentials} requiredCount={2} onChangeSelectedCredentials={onChange} />,
    )

    const first = screen.getByLabelText(/101/)
    const second = screen.getByLabelText(/202/)
    const third = screen.getByLabelText(/303/)
    expect(first.props.accessibilityRole).toBe('checkbox')

    fireEvent.press(first)
    fireEvent.press(second)
    expect(onChange).toHaveBeenLastCalledWith(['one', 'two'])

    const callsAfterRequiredSelection = onChange.mock.calls.length
    fireEvent.press(third)
    expect(onChange).toHaveBeenCalledTimes(callsAfterRequiredSelection)
  })
})
