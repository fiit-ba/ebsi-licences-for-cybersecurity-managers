import { TFunction } from 'i18next'
import type { Organization } from '@domain/organization/organization'
import { RootStackScreenProps } from '@app/navigation/types'

export type OrganizationScreenProps = RootStackScreenProps<'Organization'>
export type OrganizationMode = 'signIn' | 'register'
export interface OrganizationForm {
  invitation: string
  username: string
  password: string
  password2: string
}

export interface OrganizationScreenViewProps {
  t: TFunction
  mode: OrganizationMode
  form: OrganizationForm
  account: Organization | null
  pin: string
  pin2: string
  busy: boolean
  errorText: string
  accreditationText?: string
  accreditationEnded: boolean
  setMode: (mode: OrganizationMode) => void
  setField: (key: keyof OrganizationForm) => (value: string) => void
  setPin: (value: string) => void
  setPin2: (value: string) => void
  submit: () => Promise<void>
  createProfile: () => Promise<void>
}
