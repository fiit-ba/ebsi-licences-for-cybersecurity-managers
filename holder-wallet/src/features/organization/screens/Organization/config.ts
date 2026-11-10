import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import Organization from '@features/organization/screens/Organization'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import localeSK from '@features/organization/screens/Organization/i18n/sk'
import localeEN from '@features/organization/screens/Organization/i18n/en'

const ScreenName = SCREEN.Organization

i18next.addResourceBundle('sk', ScreenName, localeSK)
i18next.addResourceBundle('en', ScreenName, localeEN)

const OrganizationConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: Organization,
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
    // The organization's violet, where the holder's screens are navy.
    headerStyle: {
      backgroundColor: getThemeColor(ColorKeys.orgHeader),
    },
  },
}

export default OrganizationConfig
