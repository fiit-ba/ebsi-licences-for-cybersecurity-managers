// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import Register from '@features/registration/screens/Register'
// Removes the Spanish strings: the wallet offers Slovak and English.
import localeSK from '@features/registration/screens/Register/i18n/sk'
import localeEN from '@features/registration/screens/Register/i18n/en'

const ScreenName = SCREEN.Register
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const RegisterConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Register,
  options: { headerShown: false },
}

export default RegisterConfig
