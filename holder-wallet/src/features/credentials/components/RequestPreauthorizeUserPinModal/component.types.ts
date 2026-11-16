import { ModalProps } from '@app/context/Modal.context'

export type RequestPreauthorizeUserPinModalProps = ModalProps

export interface RequestPreauthorizeUserPinModalViewProps {
  data: string
  isPinFocused: boolean
  isKeyboardVisible: boolean
  title: string
  description: string
  pinLabel: string
  requestLabel: string
  close: () => void
  focus: () => void
  blur: () => void
  changePin: (value: string) => void
  accept: () => void
}
