import PresentationListView from './PresentationListView'
import usePresentationList from './usePresentationList'
import { PresentationListProps } from './component.types'

const PresentationList = (props: PresentationListProps) => <PresentationListView {...usePresentationList(props)} />
export default PresentationList
