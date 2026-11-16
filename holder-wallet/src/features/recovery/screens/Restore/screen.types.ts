import { StatusBarStyle } from 'expo-status-bar'
import { RootStackScreenProps } from '@app/navigation/types'

export type RestoreScreenProps = RootStackScreenProps<'Restore'>

export interface RestoreScreenViewProps {
  phrase: string
  pin: string
  secondPin: string
  busy: boolean
  ready: boolean
  wordCount: number
  phraseError: string
  pinError: string
  statusBarStyle: StatusBarStyle
  spinnerColor: string
  goBack: () => void
  setPhrase: (value: string) => void
  setPin: (value: string) => void
  setSecondPin: (value: string) => void
  confirm: () => Promise<void>
  labels: {
    goBack: string
    title: string
    subtitle: string
    phrase: string
    wordCount: string
    pin: string
    secondPin: string
    loading: string
    button: string
  }
}
