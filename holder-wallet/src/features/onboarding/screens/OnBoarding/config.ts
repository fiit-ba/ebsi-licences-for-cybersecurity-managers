// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import OnBoarding from '@features/onboarding/screens/OnBoarding'
// Removes the Spanish strings: the wallet offers Slovak and English.
import localeSK from '@features/onboarding/screens/OnBoarding/i18n/sk'
import localeEN from '@features/onboarding/screens/OnBoarding/i18n/en'

const ScreenName = SCREEN.OnBoarding
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const OnBoardingConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: OnBoarding,
  options: { headerShown: false },
}

export default OnBoardingConfig
