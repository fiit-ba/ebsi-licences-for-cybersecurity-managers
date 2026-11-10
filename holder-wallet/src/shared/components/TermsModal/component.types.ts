import { ModalProps } from '@app/context/Modal.context'

export type TermsModalProps = ModalProps

export interface TermsModalViewProps {
  title: string
  version?: string
  paragraphs: string[]
  buttonText: string
  onClose: () => void
}
