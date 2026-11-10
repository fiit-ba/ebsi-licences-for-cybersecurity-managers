import CredentialAccordionDetailView from './CredentialAccordionDetailView'
import useCredentialAccordionDetail from './useCredentialAccordionDetail'
import { CredentialAccordionDetailProps } from './component.types'

const CredentialAccordionDetail = (props: CredentialAccordionDetailProps) => (
  <CredentialAccordionDetailView {...useCredentialAccordionDetail(props)} />
)
export default CredentialAccordionDetail
