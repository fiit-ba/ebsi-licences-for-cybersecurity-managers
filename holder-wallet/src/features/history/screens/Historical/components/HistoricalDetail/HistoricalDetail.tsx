import HistoricalDetailView from './HistoricalDetailView'
import useHistoricalDetail from './useHistoricalDetail'
import { HistoricalDetailProps } from './component.types'

const HistoricalDetail = (props: HistoricalDetailProps) => <HistoricalDetailView {...useHistoricalDetail(props)} />
export default HistoricalDetail
