import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import Verify from '@features/verification/screens/Verify'
import Colors from '@shared/constants/Colors'
import localeSK from '@features/verification/screens/Verify/i18n/sk'
import localeEN from '@features/verification/screens/Verify/i18n/en'

const ScreenName = SCREEN.Verify

i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const VerifyConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Verify,
  options: {
    headerBackVisible: true,
    // Uses the current native-stack option for a back button without a title.
    headerBackButtonDisplayMode: 'minimal',
    // The screen sets it again on a language switch.
    get headerTitle() {
      return String(i18next.t('TITLE', { ns: ScreenName }))
    },
    headerTintColor: '#ffffff',
    headerTitleStyle: { color: '#ffffff' },
    headerStyle: {
      backgroundColor: Colors.light.headerBackground,
    },
  },
}

export default VerifyConfig
