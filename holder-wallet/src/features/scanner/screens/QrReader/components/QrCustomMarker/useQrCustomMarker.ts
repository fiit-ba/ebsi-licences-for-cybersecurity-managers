import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import qrReaderI18nKeys from '../../i18n/keys'
import { getQrFrameGap, getQrMarkerSize } from './QrCustomMarkerView'
import { QrCustomMarkerProps, QrCustomMarkerViewProps } from './component.types'

const useQrCustomMarker = (props: QrCustomMarkerProps): QrCustomMarkerViewProps => {
  const { t } = useTranslation(SCREEN.QrReader)
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  return {
    subtitle: props.subtitle,
    isReading: props.isReading,
    markerSize: getQrMarkerSize(width, height),
    frameGap: getQrFrameGap(height),
    topSafeSpace: Math.max(insets.top, 24) + 8,
    cornerColor: getThemeColor(props.isReading ? ColorKeys.success : ColorKeys.invertedText),
    successColor: getThemeColor(ColorKeys.success),
    backLabel: t(qrReaderI18nKeys.BACKWARD),
    title: t(qrReaderI18nKeys.TITLE),
    goBack: () => props.navigation.goBack(),
  }
}
export default useQrCustomMarker
