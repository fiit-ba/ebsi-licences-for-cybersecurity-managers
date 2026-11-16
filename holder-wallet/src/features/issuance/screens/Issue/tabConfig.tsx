// The Issue tab: only in an organization's wallet (design decisions D15), first in
// its bottom bar, before the tabs every holder has.
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { TabScreenConfig } from '@shared/types/navigation'
import TabBarIcon from '@shared/components/TabBarIcon'
import Issue from '@features/issuance/screens/Issue'
import localeSK from '@features/issuance/screens/Issue/i18n/sk'
import localeEN from '@features/issuance/screens/Issue/i18n/en'

i18next.addResourceBundle('sk', SCREEN.Issue, localeSK)
i18next.addResourceBundle('en', SCREEN.Issue, localeEN)

const IssueTabConfig: TabScreenConfig = {
  name: SCREEN.IssueTab,
  component: Issue,
  options: {
    // Getters: the header and the tab follow the language switch.
    get title() {
      return String(i18next.t('TITLE', { ns: SCREEN.Issue }))
    },
    get tabBarLabel() {
      return String(i18next.t('TAB', { ns: SCREEN.Issue }))
    },
    tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="file-plus-outline" selectedName="file-plus" />,
  },
}

export default IssueTabConfig
