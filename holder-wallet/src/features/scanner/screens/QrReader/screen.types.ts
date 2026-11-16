import { BarcodeScanningResult } from 'expo-camera'
import { RootStackScreenProps } from '@app/navigation/types'

export type QrReaderScreenProps = RootStackScreenProps<'QrReader'>

export interface QrReaderScreenViewProps {
  isLoading: boolean
  hasPermission: boolean | null
  isReading: boolean
  loadingColor: string
  subtitle: string
  permissionMessage: string
  navigation: QrReaderScreenProps['navigation']
  handleBarCodeScanned: (result: BarcodeScanningResult) => Promise<void>
}
