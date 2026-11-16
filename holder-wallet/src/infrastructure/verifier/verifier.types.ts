export type VerificationRequest = {
  requestUri: string
  qr: string
  state: string
  readToken: string
  expiresAt: string
}
export type LedgerEvidence = {
  contract: string
  standing?: string | null
  certificate_number?: string | null
  registered_at?: string | null
  changed_at?: string | null
}
export type CertificationBody =
  | { recorded: false }
  | {
      recorded: true
      name: string
      issued_at: string
      accredited_until_at_issuance: string | null
      accredited_at_issuance: boolean
      accredited_until: string | null
      in_force_now: boolean
      revoked_at?: string | null
      revoked_organization?: string | null
      revoked_organization_kind?: 'ti' | 'tao' | null
    }
export type CredentialEvidence = {
  state: string
  reason?: string
  issuer?: string
  key_id?: string
  valid_from?: string | null
  valid_until?: string | null
  trust_chain?: { did: string; role: string }[]
  schemas?: string[]
  ledger?: LedgerEvidence | null
  checks?: Record<string, boolean | null>
  attributes?: Record<string, unknown> | null
  certification_body?: CertificationBody | null
}
export type VerificationResult = {
  status: 'done'
  outcome: string
  verified: boolean
  credential_types: string[]
  checks: Record<string, boolean | null>
  credentials: CredentialEvidence[]
  attributes_until: string | null
  created_at: string
}
// `declined`: the holder refused in the wallet (OpenID4VP access_denied).
export type VerificationOutcome =
  { status: 'pending' | 'expired' | 'declined'; expires_at?: string } | VerificationResult
