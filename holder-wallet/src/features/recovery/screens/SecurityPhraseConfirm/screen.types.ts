import { RootStackScreenProps } from '@app/navigation/types'

export type SecurityPhraseConfirmScreenProps = RootStackScreenProps<'SecurityPhraseConfirm'>

export interface SecurityPhraseConfirmScreenViewProps {
  seedPhrase: string[]
  showedPhrase: string[]
  goBack: () => void
  selectWord: (word: string) => void
  resetSeeds: () => void
  confirmSeeds: () => Promise<void>
  labels: {
    goBack: string
    title: string
    inputLabel: string
    inputPlaceholder: string
    reset: string
    confirm: string
  }
}
