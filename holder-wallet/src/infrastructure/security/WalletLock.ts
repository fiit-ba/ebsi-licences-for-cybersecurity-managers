// Counts how often the wallet has locked. A flow that awaits something long - a
// link's presentation or issuance, a network request - notes the count when it
// starts; if the wallet locked meanwhile, the flow must not take the user past
// the sign-in screen when it ends.
import { AppState } from 'react-native'
import { SessionPin } from './SessionPin'

let locks = 0

export const WalletLock = {
  /** The wallet locked: the app went to the background, or the organization was revoked. */
  lock(): void {
    SessionPin.clear()
    locks += 1
  },
  /** The count to compare against later, with `stillUnlocked`. */
  current(): number {
    return locks
  },
  /** True when the wallet has not locked since `since` was taken. */
  stillUnlocked(since: number): boolean {
    return locks === since
  },
  /**
   * Every trip to the background locks the wallet, whichever screens are mounted.
   * LockAppWrapper puts the sign-in screen over the tabs, but a flow that runs at
   * the sign-in screen itself (a link opened on a cold start) has no tabs below
   * it. Called once, by the navigation root; returns the unsubscribe function.
   */
  watchAppState(): () => void {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') WalletLock.lock()
    })
    return () => subscription.remove()
  },
}
