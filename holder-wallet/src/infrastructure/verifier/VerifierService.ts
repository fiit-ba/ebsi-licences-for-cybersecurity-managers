import { isBackofficeConfigured } from '@infrastructure/config/Backoffice'
import { createPresentationRequest, fetchVerificationOutcome } from './verifier.client'
import { decidingCredential, mapVerificationLog, mapVerificationRequest } from './verifier.mapper'
import { appendVerificationHistory } from './verificationHistory.repository'
import { VerificationOutcome, VerificationRequest, VerificationResult } from './verifier.types'
export type {
  CertificationBody,
  CredentialEvidence,
  LedgerEvidence,
  VerificationOutcome,
  VerificationRequest,
  VerificationResult,
} from './verifier.types'
export { decidingCredential }
export const isVerifierConfigured = isBackofficeConfigured
export const requestPresentation = async (): Promise<VerificationRequest> =>
  mapVerificationRequest(await createPresentationRequest())
export const readOutcome = (request: VerificationRequest): Promise<VerificationOutcome> =>
  fetchVerificationOutcome(request)
export const recordVerification = async (state: string, result: VerificationResult): Promise<void> =>
  appendVerificationHistory(mapVerificationLog(state, result))
