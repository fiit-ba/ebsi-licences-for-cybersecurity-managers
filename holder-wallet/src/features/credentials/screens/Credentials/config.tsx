// Slovak bundle and default language (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { TabScreenConfig } from '@shared/types/navigation'
import Credentials from '@features/credentials/screens/Credentials'
// Removes the Spanish strings: the wallet offers Slovak and English.
import CredentialsI18nKeys from '@features/credentials/screens/Credentials/i18n/keys'
import TabBarIcon from '@shared/components/TabBarIcon'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@features/credentials/screens/Credentials/i18n/sk'
import localeEN from '@features/credentials/screens/Credentials/i18n/en'

const ScreenName = SCREEN.Credentials
// Registers the Slovak strings and the English ones, for the language
// switch; Spanish is no longer offered.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)
// The title comes from the bundle registered above, in the active
// language (see get title() below). The language lookup that stood here
// picked a bundle by hand, fixed to the language the app started in.

const CredentialsConfig: TabScreenConfig = {
  name: ScreenName,
  component: Credentials,
  options: {
    // A getter: the title in the active language.
    get title() {
      return String(i18next.t(CredentialsI18nKeys.TITLE, { ns: ScreenName }))
    },
    tabBarIcon: ({ focused }) => (
      <TabBarIcon focused={focused} name="card-account-details-outline" selectedName="card-account-details" />
    ),
  },
}

export default CredentialsConfig
