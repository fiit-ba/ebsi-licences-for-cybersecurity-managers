// Opening a card tells the list, which scrolls it into view: a card opened
// near the bottom of the screen used to grow below the tab bar, out of sight.
import React from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'

import CredentialDetail from '@features/credentials/screens/Credentials/components/CredentialDetail'

jest.mock('@infrastructure/openid/checkRevocation', () => ({
  currentStoredStatus: jest.fn(async () => undefined),
}))
jest.mock('@infrastructure/persistence/keychain', () => ({
  markItemStatus: jest.fn(async () => undefined),
}))
jest.mock('@features/credentials/components/PdfGenerator', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { __esModule: true, default: () => React.createElement(View) }
})
jest.mock('@features/credentials/components/CredentialAccordionDetail', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { __esModule: true, default: () => React.createElement(View, { testID: 'license-details' }) }
})

const license = JSON.stringify({
  type: ['VerifiableCredential', 'VerifiableAttestation', 'CybersecurityManagerCertificate'],
  issuer: 'did:ebsi:zTest',
  issuanceDate: '2026-10-25T10:00:00Z',
  credentialSubject: { certificateTitle: 'Licencia manažéra KB', certificateNumber: 'SK-1' },
})

describe('<CredentialDetail />', () => {
  it('asks the list to show it when it opens, and only then', async () => {
    const onExpand = jest.fn()
    const { getByText, queryByTestId } = render(
      <CredentialDetail issuer="did:ebsi:zTest" credential={license} timestamp={new Date()} onExpand={onExpand} />,
    )
    expect(queryByTestId('license-details')).toBeNull()

    await act(async () => {
      fireEvent.press(getByText('Licencia manažéra KB'))
    })
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(queryByTestId('license-details')).not.toBeNull()

    await act(async () => {
      fireEvent.press(getByText('Licencia manažéra KB'))
    })
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})
