// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import QrReader from '@features/scanner/screens/QrReader'
// Removes the Spanish strings: the wallet offers Slovak and English.
import localeSK from '@features/scanner/screens/QrReader/i18n/sk'
import localeEN from '@features/scanner/screens/QrReader/i18n/en'

const ScreenName = SCREEN.QrReader
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const QrReaderConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: QrReader,
  options: {
    headerShown: false,
  },
}

export default QrReaderConfig
