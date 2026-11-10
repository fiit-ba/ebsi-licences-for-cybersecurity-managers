// Uses React 19's component type for the lock-screen higher-order component.
import { useEffect, useState, type ComponentType } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
// Imports the session PIN, which is held in memory
// (infrastructure/security/SessionPin.ts).
import { SessionPin } from '@infrastructure/security/SessionPin'
// Counted, so flows still running when it locks do not reopen the wallet.
import { WalletLock } from '@infrastructure/security/WalletLock'
// An organization's back-office session (design decisions D15), and signing it out
// when its accreditation is revoked (D24).
import {
  OrgSession,
  activeProfile,
  anyProfileExists,
  checkStanding,
  onRevoked,
} from '@infrastructure/organization/OrganizationService'
// How often a signed-in organization asks whether it still stands (D24).
const STANDING_CHECK_MS = 60_000

const ComponentWrapper = (Component: ComponentType<any>) => (props: any) => {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState)

  const handleAppStateChange = async (nextAppState: AppStateStatus): Promise<void> => {
    if (appState === 'active' && nextAppState?.match(/background/)) {
      // The session PIN is in memory (infrastructure/security/SessionPin.ts).
      SessionPin.clear()
      WalletLock.lock()
      // The organization's session goes with it: issuing asks for the
      // password again after the wallet has locked.
      OrgSession.clear()
      // Locks whichever profile is open: the holder's wallet or the
      // organization's profile, which needs no wallet of the holder's (D18).
      const screenName = (await anyProfileExists()) ? 'Login' : 'OnBoarding'
      // Merge, not replace. Opening a link pauses the app, so this
      // runs alongside the link handler (navigation/index.tsx), which puts
      // the offer on the Login route; replacing its params dropped the offer.
      // Uses React Navigation's current positional navigate signature to retain merged params.
      // `locked`: this is a lock over the open wallet, which going back must
      // not undo (features/authentication/screens/Login, design decisions D28).
      props.navigation.navigate(screenName, { locked: true }, { merge: true })
    }
    setAppState(nextAppState)
  }
  useEffect(() => {
    const unsubscribeAppState = AppState.addEventListener('change', handleAppStateChange)
    return () => {
      unsubscribeAppState.remove()
    }
  }, [])
  // Revoked while signed in (D24): the profile locks at once, wherever its
  // tabs are, and the sign-in screen says why and no longer unlocks it. The
  // back-office says so to any request; while nothing else asks, this does,
  // every minute the organization is signed in.
  useEffect(() => {
    const stop = onRevoked(() => {
      SessionPin.clear()
      WalletLock.lock()
      props.navigation.navigate('Login', { locked: true }, { merge: true })
    })
    const timer = setInterval(() => {
      if (activeProfile() === 'organization') checkStanding().catch(() => {})
    }, STANDING_CHECK_MS)
    return () => {
      stop()
      clearInterval(timer)
    }
  }, [])

  return (
    <>
      <Component {...props} />
    </>
  )
}

export default ComponentWrapper
