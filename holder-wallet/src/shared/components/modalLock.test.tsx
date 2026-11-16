// A dialog that lists the holder's licences (a presentation request) is cancelled
// when the wallet locks; other dialogs, like the issuer's PIN, stay open.
import { useContext } from 'react'
import { AppState, AppStateStatus, Text } from 'react-native'
import { act, render } from '@testing-library/react-native'
import { CLOSED_BY_LOCK, ModalContext, ModalContextProps, ModalWrapper } from '@app/context/Modal.context'
import ModalScreen from './ModalScreen'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)

const Licences = () => <Text>Licencia manažéra kybernetickej bezpečnosti, Číslo PHONE-1</Text>

const setup = () => {
  const listeners: ((state: AppStateStatus) => void)[] = []
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void)
    return { remove: jest.fn() } as any
  })
  let modal: ModalContextProps | undefined
  const Grab = () => {
    modal = useContext(ModalContext)
    return null
  }
  const screen = render(
    <ModalWrapper>
      <Grab />
      <ModalScreen />
    </ModalWrapper>,
  )
  const background = () => act(() => listeners.forEach((listener) => listener('background')))
  return { screen, background, modal: () => modal!, restore: () => spy.mockRestore() }
}

describe('dialogs when the wallet locks', () => {
  it('cancels a dialog that shows the licences', () => {
    const { screen, background, modal, restore } = setup()
    const onCancel = jest.fn()
    act(() => modal().showModal({ Component: Licences, onCancel, closeOnLock: true }))
    expect(screen.queryByText(/PHONE-1/)).toBeTruthy()

    background()
    expect(onCancel).toHaveBeenCalledTimes(1)
    // Marked, so a presentation closed by the lock is not reported as declined.
    expect(onCancel).toHaveBeenCalledWith(CLOSED_BY_LOCK)
    expect(modal().modal.isVisible).toBe(false)
    restore()
  })

  it('keeps any other dialog, so the issuer PIN can be looked up in another app', () => {
    const { background, modal, restore } = setup()
    const onCancel = jest.fn()
    act(() => modal().showModal({ Component: Licences, onCancel }))

    background()
    expect(onCancel).not.toHaveBeenCalled()
    expect(modal().modal.isVisible).toBe(true)
    restore()
  })
})
