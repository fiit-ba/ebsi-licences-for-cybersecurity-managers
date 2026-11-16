// Slovak bundle and default language (project documentation, Slovak localization).
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { TabScreenConfig } from '@shared/types/navigation'
import Presentations from '@features/presentations/screens/Presentations'
// Removes the Spanish strings: the wallet offers Slovak and English.
import PresentationsI18nKeys from '@features/presentations/screens/Presentations/i18n/keys'
import TabBarIcon from '@shared/components/TabBarIcon'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@features/presentations/screens/Presentations/i18n/sk'
import localeEN from '@features/presentations/screens/Presentations/i18n/en'
const ScreenName = SCREEN.Presentations
// Registers the Slovak strings and the English ones, for the language
// switch; Spanish is no longer offered.
i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)
// The title comes from the bundle registered above, in the active
// language (see get title() below). The language lookup that stood here
// picked a bundle by hand, fixed to the language the app started in.

const PresentationsConfig: TabScreenConfig = {
  name: ScreenName,
  component: Presentations,
  options: {
    // A getter: the title in the active language.
    get title() {
      return String(i18next.t(PresentationsI18nKeys.TITLE, { ns: ScreenName }))
    },
    tabBarIcon: ({ focused }) => (
      <TabBarIcon focused={focused} name="share-variant-outline" selectedName="share-variant" />
    ),
  },
}

export default PresentationsConfig
