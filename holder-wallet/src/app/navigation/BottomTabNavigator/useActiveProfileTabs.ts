import { currentOrganization } from '@infrastructure/organization/OrganizationService'
import { getThemeColor } from '@shared/constants/Colors'
import { createTabConfiguration } from './createTabConfiguration'

export const useActiveProfileTabs = () => {
  const configuration = createTabConfiguration(Boolean(currentOrganization()))

  return {
    ...configuration,
    accent: getThemeColor(configuration.accentColorKey),
    headerBackground: getThemeColor(configuration.headerColorKey),
  }
}
