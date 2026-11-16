import React from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import Presentations from '@features/presentations/screens/Presentations'

jest.mock('@infrastructure/persistence/keychain', () => ({
  getPresentationList: jest.fn(async () => []),
}))

describe('<Presentations />', () => {
  it('opens the QR scanner from the presentations tab', async () => {
    const navigation = { navigate: jest.fn() }
    const screen = render(
      <Presentations navigation={navigation as any} route={{ key: 'Presentations-test', name: 'Presentations' }} />,
    )

    await act(async () => undefined)
    fireEvent.press(screen.getByTestId('presentations-scan-qr'))

    expect(navigation.navigate).toHaveBeenCalledWith('QrReader', {})
  })
})
