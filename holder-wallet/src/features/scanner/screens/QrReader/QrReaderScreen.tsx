import QrReaderScreenView from './QrReaderScreenView'
import { QrReaderScreenProps } from './screen.types'
import useQrReaderScreen from './useQrReaderScreen'

const QrReaderScreen = (props: QrReaderScreenProps) => <QrReaderScreenView {...useQrReaderScreen(props)} />

export default QrReaderScreen
