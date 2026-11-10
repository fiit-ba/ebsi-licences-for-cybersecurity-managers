import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import Restore from '@features/recovery/screens/Restore'
import localeSK from '@features/recovery/screens/Restore/i18n/sk'
import localeEN from '@features/recovery/screens/Restore/i18n/en'

const ScreenName = SCREEN.Restore

i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const RestoreConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Restore,
  options: { headerShown: false },
}

export default RestoreConfig
