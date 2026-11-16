import RequestPreauthorizeUserPinModalView from './RequestPreauthorizeUserPinModalView'
import useRequestPreauthorizeUserPinModal from './useRequestPreauthorizeUserPinModal'
import { RequestPreauthorizeUserPinModalProps } from './component.types'

const RequestPreauthorizeUserPinModal = (props: RequestPreauthorizeUserPinModalProps) => (
  <RequestPreauthorizeUserPinModalView {...useRequestPreauthorizeUserPinModal(props)} />
)
export default RequestPreauthorizeUserPinModal
