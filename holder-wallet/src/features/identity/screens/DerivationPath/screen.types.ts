import { RootStackScreenProps } from '@app/navigation/types'

export type DerivationPathScreenProps = RootStackScreenProps<'DerivationPath'>

export interface DerivationPathScreenViewProps {
  derivationPath: string
  isSeedBlur: boolean
  isCreatingDid: boolean
  goBack: () => void
  toggleSeedVisibility: () => void
  finish: () => Promise<void>
  labels: {
    goBack: string
    title: string
    subtitle: string
    hiddenTitle: string
    longPress: string
    button: string
  }
}
