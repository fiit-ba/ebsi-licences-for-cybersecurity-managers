import { ActionLog } from '@infrastructure/openid/types'
import { CredentialEvidence, VerificationRequest, VerificationResult } from './verifier.types'
export const mapVerificationRequest = (data: any): VerificationRequest => ({
  requestUri: data.request_uri,
  qr: data.qr,
  state: data.state,
  readToken: data.read_token,
  expiresAt: data.expires_at,
})
export const decidingCredential = (result: VerificationResult): CredentialEvidence | undefined =>
  result.credentials?.find((credential) => credential.state === result.outcome) ?? result.credentials?.[0]
export const mapVerificationLog = (state: string, result: VerificationResult): ActionLog => ({
  id: state,
  actionType: 'Certificate verified',
  issuer: decidingCredential(result)?.issuer ?? '',
  date: new Date(),
  data: { outcome: result.outcome, types: result.credential_types },
})
