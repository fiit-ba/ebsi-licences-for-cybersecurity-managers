import RequestPresentationModalView from './RequestPresentationModalView'
import useRequestPresentationModal from './useRequestPresentationModal'
import { RequestPresentationModalProps } from './component.types'

const RequestPresentationModal = (props: RequestPresentationModalProps) => (
  <RequestPresentationModalView {...useRequestPresentationModal(props)} />
)
export default RequestPresentationModal
