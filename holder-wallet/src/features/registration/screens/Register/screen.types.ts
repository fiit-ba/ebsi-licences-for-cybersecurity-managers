import { StatusBarStyle } from 'expo-status-bar'
import { RootStackScreenProps } from '@app/navigation/types'

export type RegisterScreenProps = RootStackScreenProps<'Register'>

export interface RegisterScreenViewProps {
  firstPin: string
  secondPin: string
  isLoading: boolean
  isPinFilled: boolean
  isTermsChecked: boolean
  hasWallet: boolean
  errorMessage: string
  statusBarStyle: StatusBarStyle
  textColor: string
  primaryColor: string
  labels: Record<string, string>
  setFirstPin: (value: string) => void
  setSecondPin: (value: string) => void
  toggleTerms: () => void
  openTerms: () => void
  submit: () => void
  goLogin: () => void
  goRestore: () => void
  goVerify: () => void
  goOrganization: () => Promise<void>
}
