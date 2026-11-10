import CredentialDetailView from './CredentialDetailView'
import useCredentialDetail from './useCredentialDetail'
import { CredentialDetailProps } from './component.types'

const CredentialDetail = (props: CredentialDetailProps) => <CredentialDetailView {...useCredentialDetail(props)} />
export default CredentialDetail
