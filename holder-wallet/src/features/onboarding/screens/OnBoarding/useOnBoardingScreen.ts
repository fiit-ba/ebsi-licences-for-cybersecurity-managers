import { useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { IMG } from '@shared/constants/urlImages'
import OnBoardingI18nKeys from './i18n/keys'
import { OnBoardingScreenProps } from './screen.types'
const useOnBoardingScreen = ({ navigation }: OnBoardingScreenProps) => {
  const { t } = useTranslation(SCREEN.OnBoarding)
  const [activePage, setActivePage] = useState(0)
  const { bottom } = useSafeAreaInsets()
  return {
    pages: [
      {
        illustration: IMG.ONBOARDING[0],
        title: t(OnBoardingI18nKeys.FIRST_SCREEN_TITLE),
        subtitle: t(OnBoardingI18nKeys.FIRST_SCREEN_SUBTITLE),
      },
      {
        illustration: IMG.ONBOARDING[1],
        title: t(OnBoardingI18nKeys.SECOND_SCREEN_TITLE),
        subtitle: t(OnBoardingI18nKeys.SECOND_SCREEN_SUBTITLE),
      },
      {
        illustration: IMG.ONBOARDING[2],
        title: t(OnBoardingI18nKeys.THIRD_SCREEN_TITLE),
        subtitle: t(OnBoardingI18nKeys.THIRD_SCREEN_SUBTITLE),
      },
      {
        illustration: IMG.ONBOARDING[3],
        title: t(OnBoardingI18nKeys.FOURTH_SCREEN_TITLE),
        subtitle: t(OnBoardingI18nKeys.FOURTH_SCREEN_SUBTITLE),
      },
    ],
    activePage,
    bottomInset: bottom,
    onPageSelected: setActivePage,
    onContinue: () => navigation.navigate(SCREEN.Register),
    continueLabel: t(OnBoardingI18nKeys.BUTTON),
  }
}
export default useOnBoardingScreen
