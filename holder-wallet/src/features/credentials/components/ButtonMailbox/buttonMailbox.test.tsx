// "Update licenses" tells the holder whether the list is current: offline, the
// licenses keep their last known status and a success message would mislead.
import { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react-native'
import { MessageContext } from '@app/context/UserMessage.context'
import useButtonMailbox from './useButtonMailbox'
import { refreshStoredStatuses } from '@infrastructure/openid/checkRevocation'
import { resolveKeychainDeferredCredentials } from '@infrastructure/persistence/keychain'
import { WalletLock } from '@infrastructure/security/WalletLock'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }))
jest.mock('@infrastructure/persistence/keychain', () => ({
  getDidList: jest.fn(async () => []),
  resolveKeychainDeferredCredentials: jest.fn(async () => undefined),
}))
jest.mock('@infrastructure/identity/lacchain/checkMailbox', () => ({ checkMailbox: jest.fn(async () => undefined) }))
jest.mock('@infrastructure/openid/checkRevocation', () => ({ refreshStoredStatuses: jest.fn() }))

const refreshed = refreshStoredStatuses as jest.Mock
const deferred = resolveKeychainDeferredCredentials as jest.Mock

const press = async () => {
  const showMessage = jest.fn()
  const onUpdated = jest.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MessageContext.Provider value={{ showMessage }}>{children}</MessageContext.Provider>
  )
  const { result } = renderHook(() => useButtonMailbox({ onUpdated } as any), { wrapper })
  await act(async () => {
    await result.current.refresh()
  })
  expect(onUpdated).toHaveBeenCalledTimes(1)
  expect(result.current.isLoading).toBe(false)
  return showMessage.mock.calls.map(([message]) => message.type)
}

describe('Update licenses', () => {
  beforeEach(() => {
    refreshed.mockReset()
    deferred.mockReset().mockResolvedValue(undefined)
    mockNavigate.mockClear()
  })

  it('goes to the licenses afterwards, unless the wallet locked during the refresh', async () => {
    refreshed.mockResolvedValue({ checked: 1, unchecked: 0 })
    await press()
    expect(mockNavigate).toHaveBeenCalledTimes(1)

    mockNavigate.mockClear()
    refreshed.mockImplementation(async () => {
      WalletLock.lock()
      return { checked: 1, unchecked: 1 }
    })
    await press()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('says the list is current when every status was read', async () => {
    refreshed.mockResolvedValue({ checked: 2, unchecked: 0 })
    expect(await press()).toEqual(['success'])
  })

  it('warns, instead of claiming success, when a status could not be read', async () => {
    refreshed.mockResolvedValue({ checked: 2, unchecked: 1 })
    expect(await press()).toEqual(['warning'])
  })

  it('warns when the refresh itself fails', async () => {
    refreshed.mockRejectedValue(new Error('offline'))
    expect(await press()).toEqual(['warning'])
  })

  it('warns when pending licenses could not be fetched', async () => {
    deferred.mockRejectedValue(new Error('Network request failed'))
    refreshed.mockResolvedValue({ checked: 0, unchecked: 0 })
    expect(await press()).toEqual(['warning'])
  })
})
