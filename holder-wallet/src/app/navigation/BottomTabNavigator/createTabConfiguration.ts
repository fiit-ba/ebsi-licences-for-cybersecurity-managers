import { RootTabParamList } from '@app/navigation/types'
import CredentialsConfig from '@features/credentials/screens/Credentials/config'
import HistoricalConfig from '@features/history/screens/Historical/config'
import IssueTabConfig from '@features/issuance/screens/Issue/tabConfig'
import PresentationsConfig from '@features/presentations/screens/Presentations/config'
import VerifyTabConfig from '@features/verification/screens/Verify/tabConfig'
import { ColorKeys } from '@shared/constants/Colors'
import { TabScreenConfig } from '@shared/types/navigation'

const holderScreens: TabScreenConfig[] = [CredentialsConfig, VerifyTabConfig, PresentationsConfig, HistoricalConfig]

const organizationScreens: TabScreenConfig[] = [IssueTabConfig, VerifyTabConfig, HistoricalConfig]

export type TabConfiguration = {
  screens: TabScreenConfig[]
  initialTab: keyof RootTabParamList
  accentColorKey: keyof typeof ColorKeys
  headerColorKey: keyof typeof ColorKeys
}

export const createTabConfiguration = (isOrganization: boolean): TabConfiguration =>
  isOrganization
    ? {
        screens: organizationScreens,
        initialTab: 'IssueTab',
        accentColorKey: ColorKeys.orgPrimary,
        headerColorKey: ColorKeys.orgHeader,
      }
    : {
        screens: holderScreens,
        initialTab: 'Credentials',
        accentColorKey: ColorKeys.primary,
        headerColorKey: ColorKeys.headerBackground,
      }
