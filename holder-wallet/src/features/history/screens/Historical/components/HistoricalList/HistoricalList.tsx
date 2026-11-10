import HistoricalListView from './HistoricalListView'
import useHistoricalList from './useHistoricalList'
import { HistoricalListProps } from './component.types'

const HistoricalList = (props: HistoricalListProps) => <HistoricalListView {...useHistoricalList(props)} />
export default HistoricalList
