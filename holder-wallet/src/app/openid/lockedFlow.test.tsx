// A presentation or an issuance ends by going back to the tabs - but not when the
// wallet locked while it ran: the sign-in screen over the tabs must stay.
import { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react-native'
import { MessageContext } from '@app/context/UserMessage.context'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { issuePresentation } from './issuePresentation'
import { useOpenId } from './useOpenId'

const mockDispatch = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ dispatch: mockDispatch }),
}))
jest.mock('@shared/hooks/useModal', () => () => ({ showModal: jest.fn() }))
jest.mock('./issuePresentation', () => ({ issuePresentation: jest.fn() }))
jest.mock('./requestCredential', () => ({ requestCredential: jest.fn() }))

const presentation = issuePresentation as jest.Mock
const REQUEST = 'openid4vp://?client_id=decentralized_identifier%3Adid%3Aebsi%3Az&request_uri=http%3A%2F%2Fv.test%2Fr'

const answer = async () => {
  const showMessage = jest.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MessageContext.Provider value={{ showMessage }}>{children}</MessageContext.Provider>
  )
  const { result } = renderHook(() => useOpenId(), { wrapper })
  let outcome: unknown
  await act(async () => {
    outcome = await result.current.handleCredentialOffer(REQUEST)
  })
  return outcome
}

describe('the end of a presentation', () => {
  beforeEach(() => mockDispatch.mockClear())

  it('goes back to the tabs while the wallet is unlocked', async () => {
    presentation.mockImplementation(async () => 'Shared')
    expect(await answer()).toBe('presentation')
    expect(mockDispatch).toHaveBeenCalledTimes(1)
  })

  it('leaves the sign-in screen in place when the wallet locked meanwhile', async () => {
    presentation.mockImplementation(async () => {
      WalletLock.lock()
      return 'Shared'
    })
    expect(await answer()).toBe('presentation')
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
