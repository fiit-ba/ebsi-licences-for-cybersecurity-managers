import { useState } from 'react'
import { OrganizationProps, OrganizationViewProps } from './component.types'

const useOrganization = (props: OrganizationProps): OrganizationViewProps => {
  const [hidden, setHidden] = useState(true)
  return { ...props, hidden, toggleHidden: () => setHidden((current) => !current) }
}
export default useOrganization
