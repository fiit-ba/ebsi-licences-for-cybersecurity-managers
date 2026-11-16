import { StatusBarStyle } from 'expo-status-bar'
import { RootStackScreenProps } from '@app/navigation/types'

export type SecurityPhraseScreenProps = RootStackScreenProps<'SecurityPhrase'>

export interface SecurityPhraseScreenViewProps {
  seedPhrase: string
  isSeedBlur: boolean
  statusBarStyle: StatusBarStyle
  goBack: () => Promise<void>
  toggleSeedVisibility: () => void
  confirmPhrase: () => void
  labels: {
    goBack: string
    title: string
    subtitle: string
    hiddenTitle: string
    longPress: string
    button: string
  }
}
