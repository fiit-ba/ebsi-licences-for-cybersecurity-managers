import QrCustomMarkerView from './QrCustomMarkerView'
import useQrCustomMarker from './useQrCustomMarker'
import { QrCustomMarkerProps } from './component.types'

const QrCustomMarker = (props: QrCustomMarkerProps) => <QrCustomMarkerView {...useQrCustomMarker(props)} />
export default QrCustomMarker
