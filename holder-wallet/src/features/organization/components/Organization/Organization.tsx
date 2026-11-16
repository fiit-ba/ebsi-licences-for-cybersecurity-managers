import { OrgFieldView } from './OrganizationView'
import useOrganization from './useOrganization'
import { OrganizationProps } from './component.types'

export const OrgField = (props: OrganizationProps) => <OrgFieldView {...useOrganization(props)} />
export { OrgButton, OrgReadOnlyField } from './OrganizationView'
export { default as OrgDateField } from './OrgDateField'
