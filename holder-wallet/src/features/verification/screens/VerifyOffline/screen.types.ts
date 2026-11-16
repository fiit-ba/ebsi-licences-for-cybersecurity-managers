import { OfflineVerification } from '@infrastructure/exchange/verify'
import { RootStackScreenProps } from '@app/navigation/types'

export type VerifyOfflineScreenProps = RootStackScreenProps<'VerifyOffline'>

export type VerifyOfflinePhase =
  | { kind: 'asking' }
  | { kind: 'checking' }
  | { kind: 'done'; result: OfflineVerification }
  | { kind: 'error'; message: string }

export interface VerifyOfflineScreenViewProps {
  phase: VerifyOfflinePhase
  primaryColor: string
  warningColor: string
  errorColor: string
  waitingText: string
  checkingText: string
  missingFieldsText: string
  scanAgainText: string
  scanAgain: () => void
}
