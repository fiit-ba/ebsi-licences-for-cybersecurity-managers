import { RefObject } from 'react'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import { CredentialData } from '@infrastructure/openid/types'
import { RootTabScreenProps } from '@app/navigation/types'

export type CredentialsScreenProps = RootTabScreenProps<'Credentials'>

export interface CredentialsScreenViewProps {
  childRef: RefObject<StateWrapperRef | null>
  stackActions: boolean
  scanActionWidth: number
  refreshActionWidth: number
  primaryColor: string
  loadCredentials: () => Promise<CredentialData[]>
  reloadCredentials: () => void
  openScanner: () => void
  openPresentation: () => void
  placeholderTitle: string
  placeholderText: string
  presentLabel: string
}
