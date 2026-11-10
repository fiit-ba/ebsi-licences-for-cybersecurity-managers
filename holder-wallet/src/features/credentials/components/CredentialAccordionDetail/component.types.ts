import { TFunction } from 'i18next'

export interface CredentialAccordionDetailProps {
  id?: string
  type?: string[]
  organization?: string
  trustedFramework?: string
  issuanceDate?: string
  validFrom?: string
  expirationDate?: string
  status?: string
  additionalInfo?: Record<string, any>
}

export interface CredentialAccordionDetailViewProps extends CredentialAccordionDetailProps {
  t: TFunction
  translatedStatus: string
  mutedColor: string
  errorColor: string
}
