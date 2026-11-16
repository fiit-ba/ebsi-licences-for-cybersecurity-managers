// Uses React 19's component type instead of the removed global JSX namespace.
import { createContext, useState, type ComponentType } from 'react'
import { ModalPropsAndroid } from 'react-native'

const ModalContext = createContext({} as any)

/** What onCancel receives when the wallet's lock, not the holder, closed the dialog. */
export const CLOSED_BY_LOCK = 'closed-by-lock'

export type ModalPropsWithoutIsVisible = {
  onAccept?: (props?: any) => void
  /** The holder closed the dialog; `CLOSED_BY_LOCK` when the wallet locked instead. */
  onCancel?: (reason?: typeof CLOSED_BY_LOCK) => void
  Component?: ComponentType<any>
  modalProps?: any
  modalContainerProps?: ModalPropsAndroid
  modalContainerStyle?: any
  /**
   * Cancel the dialog when the wallet locks (the app goes to the background), so
   * it does not stay over the sign-in screen - for dialogs that show the
   * holder's licences, like a presentation request.
   */
  closeOnLock?: boolean
}
export type ModalProps = {
  isVisible: boolean
} & ModalPropsWithoutIsVisible

export type ModalContextProps = {
  modal: ModalProps
  showModal: (props?: ModalPropsWithoutIsVisible) => void
  hideModal: () => void
}

function ModalWrapper(props: any) {
  const [modal, setModal] = useState<ModalProps>({
    isVisible: false,
    onAccept: () => {},
  })

  const showModal = (props: ModalPropsWithoutIsVisible) => {
    setModal({
      isVisible: true,
      ...props,
    })
  }
  const hideModal = () => {
    setModal({
      isVisible: false,
    })
  }
  return <ModalContext.Provider value={{ modal, showModal, hideModal }}>{props.children}</ModalContext.Provider>
}

export { ModalContext, ModalWrapper }
