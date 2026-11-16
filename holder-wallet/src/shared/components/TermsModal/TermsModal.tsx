import TermsModalView from './TermsModalView'
import useTermsModal from './useTermsModal'
import { TermsModalProps } from './component.types'

const TermsModal = (props: TermsModalProps) => <TermsModalView {...useTermsModal(props)} />
export default TermsModal
