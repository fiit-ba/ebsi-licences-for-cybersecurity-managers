import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { MessageProviderWrapper } from '@app/context/UserMessage.context'
import PresentationList from '@features/presentations/screens/Presentations/components/PresentationList'
import { revokePresentations } from '@infrastructure/persistence/keychain'

jest.mock('@infrastructure/persistence/keychain', () => ({
  revokePresentations: jest.fn(async (items: string[]) => items),
}))

const presentations = Array.from({ length: 12 }, (_, index) => ({
  id: `urn:uuid:presentation-${index}`,
  issuer: 'https://verifier.example',
  verifier: 'https://verifier.example',
  validFrom: '2026-10-08T12:00:00.000Z',
  expirationDate: '2026-10-08T12:15:00.000Z',
  timestamp: `2026-10-08T12:${String(index).padStart(2, '0')}:00.000Z`,
  status: 'Active' as const,
  credential: 'legacy-presentation',
  credentialTypes: ['CybersecurityManagerCertificate'],
  credentialCount: 1,
  legacy: false,
}))

describe('<PresentationList />', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('selects and revokes the complete list without a full-screen reload', async () => {
    const screen = render(
      <MessageProviderWrapper>
        <PresentationList presentations={presentations} />
      </MessageProviderWrapper>,
    )

    fireEvent.press(screen.getByText('MANAGE'))
    expect(screen.getByText('REVOKE')).toBeDefined()
    expect(screen.getByText('SELECTED_COUNT')).toBeDefined()

    fireEvent.press(screen.getByText('SELECT_ALL'))
    expect(screen.getByText('REVOKE')).toBeDefined()
    expect(screen.getByText('ALL_SELECTED')).toBeDefined()
    expect(screen.queryByText('SELECT_ALL')).toBeNull()

    fireEvent.press(screen.getByText('REVOKE'))

    await waitFor(() => {
      expect(revokePresentations).toHaveBeenCalledTimes(1)
      expect(revokePresentations).toHaveBeenCalledWith(presentations.map(({ timestamp }) => timestamp))
      expect(screen.queryAllByText('Licencia manažéra kybernetickej bezpečnosti')).toHaveLength(0)
      expect(screen.getByText('NO_ACTIVE_PRESENTATIONS')).toBeDefined()
    })
  })

  it('uses Cancel as the single action for clearing selection and leaving manage mode', () => {
    const screen = render(
      <MessageProviderWrapper>
        <PresentationList presentations={presentations.slice(0, 2)} />
      </MessageProviderWrapper>,
    )

    fireEvent.press(screen.getByText('MANAGE'))
    fireEvent.press(screen.getByText('SELECT_ALL'))

    expect(screen.queryByText('CLEAR_ALL')).toBeNull()
    expect(screen.getByText('ALL_SELECTED')).toBeDefined()
    fireEvent.press(screen.getByText('CANCEL'))

    expect(screen.getByText('MANAGE')).toBeDefined()
    expect(screen.queryByText('REVOKE')).toBeNull()
  })
})
