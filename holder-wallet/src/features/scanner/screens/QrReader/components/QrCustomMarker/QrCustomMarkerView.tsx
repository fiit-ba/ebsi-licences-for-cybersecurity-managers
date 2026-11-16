import type { ViewStyle } from 'react-native'
import {
  BackButton,
  BottomSpace,
  InstructionPanel,
  LateralSpace,
  Marker,
  MarkerCorner,
  MarkerContainer,
  SubTitle,
  TextContainer,
  Title,
  TopSafeSpace,
  ViewContainer,
} from '@features/scanner/screens/QrReader/components/QrCustomMarker/component.styles'
import { ActivityIndicator } from 'react-native-paper'
import { QrCustomMarkerViewProps } from './component.types'
// Shared sizing limits keep the target usable on compact phones without
// becoming oversized on Pro Max phones or tablets.
export const getQrMarkerSize = (width: number, height: number): number =>
  Math.max(216, Math.min(width * 0.74, height * 0.36, 320))
// Provides visible separation from the instructions while staying proportional
// on both compact and tall phones.
export const getQrFrameGap = (height: number): number => Math.max(28, Math.min(height * 0.04, 40))
// One data-driven definition keeps all four corner guides visually identical.
const markerCorners: ViewStyle[] = [
  { top: -8, left: -8, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  { top: -8, right: -8, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  { bottom: -8, left: -8, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
  { bottom: -8, right: -8, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
]

const QrCustomMarkerView = ({
  subtitle,
  isReading,
  markerSize,
  frameGap,
  topSafeSpace,
  cornerColor,
  successColor,
  backLabel,
  title,
  goBack,
}: QrCustomMarkerViewProps) => {
  return (
    <ViewContainer>
      <LateralSpace />
      <MarkerContainer style={{ width: markerSize }}>
        {/*
            Absolute scanner overlays do not inherit SafeAreaView padding. Reserve
            it explicitly so controls never collide with a notch or status bar. */}
        <TopSafeSpace style={{ height: topSafeSpace }} />
        <TextContainer style={{ paddingBottom: frameGap }}>
          <BackButton accessibilityRole="button" onPress={goBack}>
            {backLabel}
          </BackButton>
          <InstructionPanel>
            <Title>{title}</Title>
            <SubTitle>{subtitle}</SubTitle>
          </InstructionPanel>
        </TextContainer>
        <Marker style={{ width: markerSize, height: markerSize }}>
          {/*
              Guides sit outside the scan square and turn green while a decoded
              QR value is being processed. */}
          {markerCorners.map((style, index) => (
            <MarkerCorner
              key={index}
              testID={`qr-marker-corner-${index}`}
              style={[style, { borderColor: cornerColor }]}
            />
          ))}
          {isReading && <ActivityIndicator color={successColor} size={70} />}
        </Marker>
        <BottomSpace />
      </MarkerContainer>
      <LateralSpace />
    </ViewContainer>
  )
}

export default QrCustomMarkerView
