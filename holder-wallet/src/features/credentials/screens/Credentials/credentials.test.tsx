import React from 'react'
// Flushes StateWrapper's asynchronous Keychain-backed initialization before assertions.
import { act, render, waitFor } from '@testing-library/react-native'

import Credential from '@features/credentials/screens/Credentials'
import { TEST_LABELS } from '@features/credentials/screens/Credentials/constants/testLabels'
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
// Gives component tests a deterministic empty credential list without opening the native Keychain.
jest.mock('@infrastructure/persistence/keychain', () => ({
  getCredentialsList: jest.fn(async () => []),
  getDidList: jest.fn(async () => []),
}))
// Isolates the Credentials screen from Placeholder's mailbox and native crypto dependencies.
jest.mock('@shared/components/Placeholder', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'credentials-empty-state' }),
  }
})
// Avoids loading mailbox crypto from the unused non-empty list branch in empty-state tests.
jest.mock('@features/credentials/screens/Credentials/components/CredentialList', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'credential-list' }),
  }
})

const mockedNavigation: any = {
  navigate: jest.fn(),
  route: jest.fn(),
}
describe('<Credentials />', () => {
  const ScreenName = SCREEN.Credentials

  // Adds a resource bundle for the Spanish language to i18next with the translations for the Register screen
  // Registers no Spanish strings: the wallet offers Slovak and English.
  it('should render ', async () => {
    const result = render(<Credential {...mockedNavigation} />)
    // Snapshots the completed empty state rather than the transient loading indicator.
    await act(async () => undefined)
    expect(result.getByTestId('credentials-empty-state')).toBeDefined()
    expect(result.toJSON()).toMatchSnapshot()
  })
  it('Should renders correctly', async () => {
    const { getByTestId, queryByRole } = render(<Credential {...mockedNavigation} i18next={i18next} />)
    // Lets the StateWrapper effect settle before this test finishes and unmounts the screen.
    await act(async () => undefined)
    expect(queryByRole('progressbar')).toBeNull()
    const ActionButton = getByTestId(TEST_LABELS.ActionButton)

    expect(ActionButton).toBeDefined()
  })
  // A restore that gets its backup after sign-in writes the wallet once the
  // list was read (design decisions D31); the list shows it without the holder
  // leaving the tab.
  it('shows what is written into the wallet while it is open', async () => {
    const keychain = require('@infrastructure/persistence/keychain')
    const { walletChanged } = require('@infrastructure/backup/changes')
    const { getByTestId, queryByTestId } = render(<Credential {...mockedNavigation} />)
    await act(async () => undefined)
    expect(getByTestId('credentials-empty-state')).toBeDefined()

    keychain.getCredentialsList.mockResolvedValue([
      { id: 'urn:uuid:restored', credential: 'jwt', timestamp: new Date() },
    ])
    act(() => walletChanged())
    await waitFor(() => expect(getByTestId('credential-list')).toBeDefined())
    expect(queryByTestId('credentials-empty-state')).toBeNull()
  })
})
