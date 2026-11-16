import type { VerificationRequest, VerificationResult } from '@infrastructure/verifier/verifier.types'
import { RootStackScreenProps, RootTabScreenProps } from '@app/navigation/types'

export type VerifyScreenProps =
  (Partial<RootStackScreenProps<'Verify'>> & { inTab?: false }) | (RootTabScreenProps<'VerifyTab'> & { inTab: true })
export type VerifyPhase =
  | { kind: 'starting' }
  | { kind: 'waiting'; request: VerificationRequest; expiresAt: string }
  | { kind: 'expired' }
  | { kind: 'declined' }
  | { kind: 'done'; result: VerificationResult }
  | { kind: 'error'; message: string }

export interface VerifyScreenViewProps {
  phase: VerifyPhase
  qrSide: number
  primaryColor: string
  warningColor: string
  errorColor: string
  recordNote: string
  labels: {
    offlineScan: string
    offlineHint: string
    connecting: string
    intro: string
    qr: string
    waiting: string
    newRequest: string
    expired: string
    declined: string
    retry: string
    verifyAnother: string
  }
  start: () => Promise<void>
  retry: () => void
  openOfflineScanner: () => void
}
