// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
// Removes the Spanish strings: the wallet offers Slovak and English.
import DerivationPath from '@features/identity/screens/DerivationPath'
import localeSK from '@features/identity/screens/DerivationPath/i18n/sk'
import localeEN from '@features/identity/screens/DerivationPath/i18n/en'

const ScreenName = SCREEN.DerivationPath
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const DerivationPathConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: DerivationPath,
  options: { headerShown: false },
}

export default DerivationPathConfig
