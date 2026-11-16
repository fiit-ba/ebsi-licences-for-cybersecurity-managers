// A link's flow (a presentation, an issuance) started at sign-in can outlast the
// session. If the wallet locked meanwhile, ending the flow must not open the
// tabs: the sign-in screen stays until the PIN is entered again.
import { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react-native'
import { MessageContext } from '@app/context/UserMessage.context'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { executeCallbackFunction } from '@shared/utils/storeCallback'
import useLoginScreen from './useLoginScreen'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@infrastructure/persistence/keychain', () => ({
  checkPin: jest.fn(async () => true),
  getKeychainDataObject: jest.fn(async () => ({ did: { ebsi: 'did:key:zHolder' } })),
}))
jest.mock('@shared/utils/storeCallback', () => ({ executeCallbackFunction: jest.fn() }))
jest.mock('@shared/hooks/useEbsiDid', () => () => async () => true)
jest.mock('@infrastructure/openid/checkRevocation', () => ({
  refreshStoredStatuses: jest.fn(async () => ({ checked: 0, unchecked: 0 })),
}))
jest.mock('@infrastructure/backup', () => ({ resumeBackups: jest.fn(async () => undefined) }))
jest.mock('@infrastructure/organization/OrganizationService', () => ({
  activeProfile: () => 'holder',
  currentOrganization: () => null,
  checkOrganizationPin: () => false,
  deleteOrganizationProfile: jest.fn(),
  openProfile: jest.fn(async () => true),
}))

const flow = executeCallbackFunction as jest.Mock

const signIn = async () => {
  const navigation = {
    addListener: jest.fn(() => jest.fn()),
    getState: () => ({ index: 0, routes: [{ name: 'Login' }] }),
    isFocused: () => true,
    navigate: jest.fn(),
    replace: jest.fn(),
    reset: jest.fn(),
    setParams: jest.fn(),
  }
  const route = { params: { callback: { id: 'presentation', params: ['openid4vp://?request_uri=x'] } } }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MessageContext.Provider value={{ showMessage: jest.fn() }}>{children}</MessageContext.Provider>
  )
  const { result } = renderHook(() => useLoginScreen({ navigation, route } as any), { wrapper })
  act(() => result.current.setPin('135790'))
  await act(async () => {
    await result.current.unlock()
  })
  const opened = [...navigation.replace.mock.calls, ...navigation.navigate.mock.calls, ...navigation.reset.mock.calls]
  return opened.some((call) => JSON.stringify(call).includes('Root'))
}

describe("sign-in with a link's flow", () => {
  it('opens the tabs when the flow ends while the wallet is unlocked', async () => {
    flow.mockImplementation(async () => undefined)
    expect(await signIn()).toBe(true)
  })

  it('stays on the sign-in screen when the wallet locked during the flow', async () => {
    flow.mockImplementation(async () => WalletLock.lock())
    expect(await signIn()).toBe(false)
  })

  it('stays on the sign-in screen when the flow fails after a lock', async () => {
    flow.mockImplementation(async () => {
      WalletLock.lock()
      throw new Error('The presentation was cancelled')
    })
    expect(await signIn()).toBe(false)
  })
})
