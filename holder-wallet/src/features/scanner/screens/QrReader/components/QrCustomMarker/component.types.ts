import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RootStackParamList } from '@app/navigation/types'

export interface QrCustomMarkerProps {
  subtitle: string
  navigation: NativeStackNavigationProp<RootStackParamList>
  isReading: boolean
}

export interface QrCustomMarkerViewProps {
  subtitle: string
  isReading: boolean
  markerSize: number
  frameGap: number
  topSafeSpace: number
  cornerColor: string
  successColor: string
  backLabel: string
  title: string
  goBack: () => void
}
