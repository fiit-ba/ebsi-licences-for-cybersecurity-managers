// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
// Removes the Spanish strings: the wallet offers Slovak and English.
import DidList from '@features/identity/screens/DidList'
import Colors from '@shared/constants/Colors'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@features/identity/screens/DidList/i18n/sk'
import localeEN from '@features/identity/screens/DidList/i18n/en'

const ScreenName = SCREEN.DidList
// Registers the Slovak strings and the English ones, for the language
// switch; Spanish is no longer offered.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)
const DidListConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: DidList,
  options: {
    headerBackVisible: true,
    // Uses the current native-stack option for a back button without a title.
    headerBackButtonDisplayMode: 'minimal',
    headerBackButtonMenuEnabled: true,
    // The active language's title; it was hard-wired to the Spanish one.
    // A getter, so the title follows the language switch.
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

export default DidListConfig
