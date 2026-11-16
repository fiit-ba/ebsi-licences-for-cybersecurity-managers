import OrganizationScreenView from './OrganizationScreenView'
import { OrganizationScreenProps } from './screen.types'
import useOrganizationScreen from './useOrganizationScreen'

const OrganizationScreen = (props: OrganizationScreenProps) => (
  <OrganizationScreenView {...useOrganizationScreen(props)} />
)

export default OrganizationScreen
