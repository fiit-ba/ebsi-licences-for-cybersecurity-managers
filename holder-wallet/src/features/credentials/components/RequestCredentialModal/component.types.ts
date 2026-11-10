import { ModalProps } from '@app/context/Modal.context'

export type RequestCredentialModalProps = ModalProps

export interface RequestCredentialModalViewProps {
  title: string
  description: string
  credentialRequestDescription: string
  credentialParams: Record<string, string>
  dropdownItems: { label: string; value: string }[]
  dropdownPlaceholder: string
  buttonText: string
  close: () => void
  setData: (data: any) => void
  accept: () => void
}
