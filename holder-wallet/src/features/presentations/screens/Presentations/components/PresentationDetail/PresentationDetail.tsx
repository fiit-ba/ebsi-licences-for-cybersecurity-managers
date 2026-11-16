import PresentationDetailView from './PresentationDetailView'
import usePresentationDetail from './usePresentationDetail'
import { PresentationDetailProps } from './component.types'

const PresentationDetail = (props: PresentationDetailProps) => (
  <PresentationDetailView {...usePresentationDetail(props)} />
)
export default PresentationDetail
