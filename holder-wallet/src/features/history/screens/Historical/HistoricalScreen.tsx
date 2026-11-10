import HistoricalScreenView from './HistoricalScreenView'
import { HistoricalScreenProps } from './screen.types'
import useHistoricalScreen from './useHistoricalScreen'

const HistoricalScreen = (props: HistoricalScreenProps) => <HistoricalScreenView {...useHistoricalScreen(props)} />

export default HistoricalScreen
