/**
 * If you are not familiar with React Navigation, refer to the "Fundamentals" guide:
 * https://reactnavigation.org/docs/getting-started
 *
 */
// Imports the global listener for incoming links and the wallet's dark theme.
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useEffect, useState } from 'react'
import { ColorSchemeName, Linking } from 'react-native'
import { claimUrl } from '@shared/hooks/useDeepLinking'
import { RootStackParamList } from '@app/navigation/types'
import { ColorKeys, getThemeColor, navDarkTheme, navTheme } from '@shared/constants/Colors'
import LoginConfig from '@features/authentication/screens/Login/config'
import RegisterConfig from '@features/registration/screens/Register/config'
import SplashScreenConfig from '@features/startup/screens/SplashScreen/config'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { navigationScreensConfigType } from '@shared/types/navigation'
import LinkingConfiguration from '@app/navigation/LinkingConfiguration'
import OnBoardingConfig from '@features/onboarding/screens/OnBoarding/config'
import SecurityPhraseConfirmConfig from '@features/recovery/screens/SecurityPhraseConfirm/config'
import SecurityPhraseConfig from '@features/recovery/screens/SecurityPhrase/config'
import DerivationPathConfig from '@features/identity/screens/DerivationPath/config'
// Removes the NetworkAuth screen: the EBSI DID is created by the button that
// leads on (shared/hooks/useEbsiDid.ts).
import BottomTabNavigator from '@app/navigation/BottomTabNavigator'
import QrReaderConfig from '@features/scanner/screens/QrReader/config'
import { DeepLinkingWrapper } from '@app/navigation/wrappers/DeepLinkingWrapper'
import { WalletLock } from '@infrastructure/security/WalletLock'
import TabNavigatorHeaderDropDown from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown'
import DidListConfig from '@features/identity/screens/DidList/config'
// Imports the verifier (component 6, design decisions D14).
import VerifyConfig from '@features/verification/screens/Verify/config'
// Imports the organization's sign-in and registration (design decisions D15).
import OrganizationConfig from '@features/organization/screens/Organization/config'
import { checkIfAppWasReinstalled } from '@infrastructure/persistence/keychain'
// The organization's profile, independent of the holder's wallet (D18).
import { hasOrganizationProfile, restoreOrganization } from '@infrastructure/organization/OrganizationService'
// Restoring from the security phrase, and the encrypted backup that makes it
// bring the certificates back (design decisions D31).
import RestoreConfig from '@features/recovery/screens/Restore/config'
import { startBackups } from '@infrastructure/backup'
// Presenting phone to phone, and verifying without the server (D33).
import PresentConfig from '@features/presentations/screens/Present/config'
import VerifyOfflineConfig from '@features/verification/screens/VerifyOffline/config'

export default function Navigation({ colorScheme }: { colorScheme: ColorSchemeName }) {
  const navigationRef = useNavigationContainerRef()
  // Going to the background locks the wallet everywhere, not only under the tabs
  // (infrastructure/security/WalletLock.ts).
  useEffect(() => WalletLock.watchAppState(), [])
  // A credential offer or presentation request opened while the wallet
  // runs (a link in the certification body's e-mail, say) goes to the sign-in
  // screen with the link as its callback - the holder confirms with the PIN,
  // then the offer is handled, as on a cold start. Before, only screens of the
  // setup flow listened, so from the tab screens the link was dropped.
  // Each arrival is a new tap, so a link handled before is handled again - a
  // holder who cancelled the PIN taps the same link once more. Only the launch
  // link is replayed (Linking.getInitialURL), and claiming it here keeps a
  // later sign-in from opening it a second time (shared/hooks/useDeepLinking.ts).
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      claimUrl(url)
      if (!url || !navigationRef.isReady()) return
      navigationRef.navigate('Login', {
        callback: { id: 'SameDeviceCredentialCallback', params: [url] },
      })
    })
    return () => subscription.remove()
  }, [navigationRef])

  return (
    <NavigationContainer
      linking={LinkingConfiguration}
      // The wallet's dark theme (src/constants/Colors.ts).
      theme={colorScheme === 'dark' ? navDarkTheme : navTheme}
      ref={navigationRef}
    >
      <RootNavigator />
    </NavigationContainer>
  )
}

const navigationScreensConfig: navigationScreensConfigType[] = [
  SplashScreenConfig,
  OnBoardingConfig,
  RegisterConfig,
  LoginConfig,
  SecurityPhraseConfig,
  SecurityPhraseConfirmConfig,
  DerivationPathConfig,
  // No NetworkAuth screen (see the imports).
  QrReaderConfig,
  DidListConfig,
  // The verifier, reachable before registration as well as from the header
  // menu, so it sits in the root stack rather than among the tabs.
  VerifyConfig,
  // An organization signs in or applies from the registration screen.
  OrganizationConfig,
  // Restoring a wallet, from the registration screen.
  RestoreConfig,
  // Presenting from the Certificates tab; verifying from a scanned QR code.
  PresentConfig,
  VerifyOfflineConfig,
]

/**
 * A root stack navigator is often used for displaying modals on top of all other content.
 * https://reactnavigation.org/docs/modal
 */
const Stack = createNativeStackNavigator<RootStackParamList>()

function RootNavigator(): any {
  const [isWalletCreated, setisWalletCreated] = useState<boolean | null>(null)

  useEffect(() => {
    const initialize = async () => {
      // The backup follows every change of the wallet from now on (D31).
      startBackups()
      await checkIfAppWasReinstalled()
      // Read the organization's profile again: a fresh install has just
      // wiped the keychain it is kept in (D18).
      await restoreOrganization()
      await skipOnboarding()
    }
    initialize()
  }, [])

  const skipOnboarding = async (): Promise<void> => {
    try {
      // Either profile is something to sign in to: the holder's wallet or
      // the organization's profile (D18).
      const data = (await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED)) || hasOrganizationProfile()
      if (!data) {
        setisWalletCreated(false)
      } else {
        setisWalletCreated(true)
      }
    } catch (error) {
      throw new Error(`Error retrieving data. ${error}`)
    }
  }

  return (
    isWalletCreated !== null && (
      <Stack.Navigator initialRouteName={isWalletCreated ? 'Login' : 'OnBoarding'}>
        {navigationScreensConfig.map((props: any, index) => (
          <Stack.Screen {...props} component={DeepLinkingWrapper(props.component)} key={props.name || index} />
        ))}
        <Stack.Screen
          name="Root"
          component={BottomTabNavigator}
          options={{
            headerRight: () => <TabNavigatorHeaderDropDown />,
            headerBackVisible: false,
            headerBackButtonMenuEnabled: false,
            headerTitleStyle: { color: getThemeColor(ColorKeys.invertedText), fontSize: 22 },
            headerStyle: {
              backgroundColor: getThemeColor(ColorKeys.headerBackground),
            },
          }}
        />
      </Stack.Navigator>
    )
  )
}
