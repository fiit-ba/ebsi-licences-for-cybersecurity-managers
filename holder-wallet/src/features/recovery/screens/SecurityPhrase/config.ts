// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
// Removes the Spanish strings: the wallet offers Slovak and English.
import SecurityPhrase from '@features/recovery/screens/SecurityPhrase'
import localeSK from '@features/recovery/screens/SecurityPhrase/i18n/sk'
import localeEN from '@features/recovery/screens/SecurityPhrase/i18n/en'

const ScreenName = SCREEN.SecurityPhrase
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const SecurityPhraseConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: SecurityPhrase,
  options: { headerShown: false },
}

export default SecurityPhraseConfig
