import CredentialListView from './CredentialListView'
import useCredentialList from './useCredentialList'
import { CredentialListProps } from './component.types'

const CredentialList = (props: CredentialListProps) => <CredentialListView {...useCredentialList(props)} />
export default CredentialList
