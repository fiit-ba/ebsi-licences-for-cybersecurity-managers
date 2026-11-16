import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import Present from '@features/presentations/screens/Present'
import localeSK from '@features/presentations/screens/Present/i18n/sk'
import localeEN from '@features/presentations/screens/Present/i18n/en'

const ScreenName = SCREEN.Present

i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const PresentConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Present,
  options: { headerShown: true },
}

export default PresentConfig
