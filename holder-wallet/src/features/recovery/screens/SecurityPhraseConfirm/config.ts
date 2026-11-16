// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
// Removes the Spanish strings: the wallet offers Slovak and English.
import SecurityPhraseConfirm from '@features/recovery/screens/SecurityPhraseConfirm'
import localeSK from '@features/recovery/screens/SecurityPhraseConfirm/i18n/sk'
import localeEN from '@features/recovery/screens/SecurityPhraseConfirm/i18n/en'

const ScreenName = SCREEN.SecurityPhraseConfirm
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const SecurityPhraseConfirmConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: SecurityPhraseConfirm,
  options: { headerShown: false },
}

export default SecurityPhraseConfirmConfig
