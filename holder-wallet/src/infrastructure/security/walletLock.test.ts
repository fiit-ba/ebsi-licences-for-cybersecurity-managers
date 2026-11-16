// Going to the background locks the wallet wherever the user is: the session PIN
// is forgotten and flows that were running see that the wallet locked.
import { AppState, AppStateStatus } from 'react-native'
import { SessionPin } from './SessionPin'
import { WalletLock } from './WalletLock'

describe('the wallet lock', () => {
  it('locks on every trip to the background, and only then', () => {
    let listener: ((state: AppStateStatus) => void) | undefined
    const remove = jest.fn()
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void
      return { remove } as any
    })
    const stop = WalletLock.watchAppState()
    SessionPin.set('135790')
    const before = WalletLock.current()

    listener!('active')
    listener!('inactive')
    expect(WalletLock.stillUnlocked(before)).toBe(true)
    expect(SessionPin.get()).toBe('135790')

    listener!('background')
    expect(WalletLock.stillUnlocked(before)).toBe(false)
    expect(SessionPin.get()).toBe('')

    stop()
    expect(remove).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
