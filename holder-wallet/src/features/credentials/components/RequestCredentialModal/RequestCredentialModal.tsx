import RequestCredentialModalView from './RequestCredentialModalView'
import useRequestCredentialModal from './useRequestCredentialModal'
import { RequestCredentialModalProps } from './component.types'

const RequestCredentialModal = (props: RequestCredentialModalProps) => (
  <RequestCredentialModalView {...useRequestCredentialModal(props)} />
)
export default RequestCredentialModal
