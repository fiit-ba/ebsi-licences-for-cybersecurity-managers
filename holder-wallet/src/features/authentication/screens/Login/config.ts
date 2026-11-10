// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
// Removes the Spanish strings: the wallet offers Slovak and English.
import Login from '@features/authentication/screens/Login'
import localeSK from '@features/authentication/screens/Login/i18n/sk'
import localeEN from '@features/authentication/screens/Login/i18n/en'

const ScreenName = SCREEN.Login
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const LoginConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Login,
  // No swipe back on iOS either: a lock that a gesture removes is no lock.
  options: { headerShown: false, gestureEnabled: false },
}

export default LoginConfig
