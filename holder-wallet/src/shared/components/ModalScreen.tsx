import { useEffect, useRef } from 'react'
import { AppState, Modal, StatusBar, View } from 'react-native'
import useModal from '@shared/hooks/useModal'
import { CLOSED_BY_LOCK } from '@app/context/Modal.context'
// The safe-area insets and theme colours for the frame below.
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ColorKeys, getAppColorScheme, getThemeColor } from '@shared/constants/Colors'

const modalStyleDefault = {
  backgroundColor: 'white',
  borderRadius: 10,
  justifyContent: 'flex-start',
}

export default function ModalWrapper() {
  const { modal, hideModal } = useModal()
  const { onCancel, Component, isVisible, modalContainerStyle, modalContainerProps } = modal
  const { Component: AuxComponent, ...modalProps } = modal
  // Native modals have their own window on both platforms. Always apply the
  // measured insets here so every full-screen modal clears the status bar,
  // camera island and home indicator consistently.
  const insets = useSafeAreaInsets()
  // --- End of the change made by the Faculty of Informatics and Information Technologies. ---
  const handleOnCancel = () => {
    onCancel?.()
    hideModal()
  }
  // A dialog showing the holder's licences (closeOnLock) does not outlive the
  // session: when the wallet locks, it is cancelled as if the holder had closed it.
  const latest = useRef(modal)
  latest.current = modal
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const current = latest.current
      if (next !== 'background' || !current.isVisible || !current.closeOnLock) return
      current.onCancel?.(CLOSED_BY_LOCK)
      hideModal()
    })
    return () => subscription.remove()
  }, [])

  const handleOnAccept = (propsResponse?: any) => {
    modal.onAccept?.(propsResponse)
    hideModal()
  }

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={handleOnCancel}
      style={{ ...modalStyleDefault, ...modalContainerStyle }}
      {...modalContainerProps}
    >
      <StatusBar
        backgroundColor={getThemeColor(ColorKeys.background)}
        barStyle={getAppColorScheme() === 'dark' ? 'light-content' : 'dark-content'}
      />
      {/*  */}
      {/* Keep all modal content between the system bars on iOS and Android. */}
      {!!Component ? (
        <View
          style={{
            flex: 1,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            backgroundColor: getThemeColor(ColorKeys.background),
          }}
        >
          <View style={{ flex: 1 }}>
            <Component {...modalProps} onCancel={handleOnCancel} onAccept={handleOnAccept} />
          </View>
        </View>
      ) : (
        <></>
      )}
    </Modal>
  )
}
