import { StatusBar } from 'react-native'
import QrCustomMarker from '@features/scanner/screens/QrReader/components/QrCustomMarker'
import QrReaderStyled from '@features/scanner/screens/QrReader/screen.styles'
// Replaces removed expo-barcode-scanner APIs with Expo Camera's permission and result types.
import { ActivityIndicator } from 'react-native-paper'
import { QrReaderScreenViewProps } from './screen.types'

const QrReaderScreenView = ({
  isLoading,
  hasPermission,
  isReading,
  loadingColor,
  subtitle,
  permissionMessage,
  navigation,
  handleBarCodeScanned,
}: QrReaderScreenViewProps) => {
  if (isLoading) {
    return (
      <QrReaderStyled.Container>
        <ActivityIndicator
          style={{ position: 'absolute', alignSelf: 'center', top: '45%', zIndex: 100000 }}
          color={loadingColor}
          size={70}
        />
      </QrReaderStyled.Container>
    )
  } else if (hasPermission) {
    return (
      <QrReaderStyled.Container>
        <StatusBar barStyle="light-content" />
        {/*
            Restricts Expo Camera to QR codes and uses its current scan callback. */}
        <QrReaderStyled.QrScanner
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={!isReading ? handleBarCodeScanned : undefined}
        />
        <QrCustomMarker isReading={isReading} subtitle={subtitle} navigation={navigation} />
      </QrReaderStyled.Container>
    )
  } else {
    return (
      <QrReaderStyled.Container style={{ justifyContent: 'center' }}>
        <StatusBar backgroundColor={'black'} barStyle="light-content" />
        <QrReaderStyled.RequestingText>{permissionMessage}</QrReaderStyled.RequestingText>
      </QrReaderStyled.Container>
    )
  }
}

export default QrReaderScreenView
