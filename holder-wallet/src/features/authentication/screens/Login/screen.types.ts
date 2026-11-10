import { EdgeInsets } from 'react-native-safe-area-context'
import { TFunction } from 'i18next'
import type { Organization, ProfileKind } from '@domain/organization/organization'
import { RootStackScreenProps } from '@app/navigation/types'

export type LoginScreenProps = RootStackScreenProps<'Login'>

export interface LoginScreenViewProps {
  organization: Organization | null
  pin: string
  isLoading: boolean
  compact: boolean
  insets: EdgeInsets
  tagline: string
  placeholderColor: string
  t: TFunction
  setPin: (value: string) => void
  switchTo: (kind: ProfileKind) => Promise<void>
  goToRegister: () => Promise<void>
  goToVerify: () => void
  unlock: () => Promise<void>
  unlockHolder: () => Promise<void>
  removeOrganization: () => void
}
