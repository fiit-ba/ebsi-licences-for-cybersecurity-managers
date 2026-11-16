import { Credential } from '@infrastructure/openid/types'

export interface CredentialDetailProps {
  issuer: string
  key?: string
  credential?: Credential | string
  status?: string
  timestamp?: Date
  onExpand?: () => void
}

export interface CredentialDetailViewProps {
  itemKey?: string
  issuer: string
  credential: any
  expanded: boolean
  loading: boolean
  currentStatus?: string
  needsAttention: boolean
  displayCertificateTitle: string
  reference?: string
  formattedIssueDate: string
  formattedExpDate: string
  isExpired: boolean
  displayCredentialType: string[]
  trustedFramework: string
  issuedAt?: string
  validFrom?: string
  expiresAt?: string
  additionalInfo?: Record<string, any>
  primaryColor: string
  errorColor: string
  labels: {
    reference: string
    issuanceDate: string
    expires: string
    state: string
    suspended: string
    revoked: string
  }
  handlePress: () => Promise<void>
}
