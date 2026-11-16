import React from 'react'
// Flushes the initial AsyncStorage lookup before Register assertions are evaluated.
import { act, render, fireEvent } from '@testing-library/react-native'
import App from '@features/registration/screens/Register'
import { testID } from '@features/registration/screens/Register/constants/testID'
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
// Removes the obsolete jest-native extension and supplies the modal context now required in tests.
import { ModalWrapper } from '@app/context/Modal.context'
// Removes the Spanish strings: the wallet offers Slovak and English.

// describe block that groups together related tests for the <App /> component
describe('<Register />', () => {
  const mockShowModal = jest.fn()
  const ScreenName = SCREEN.Register

  // Adds a resource bundle for the Spanish language to i18next with the translations for the Register screen
  // Registers no Spanish strings: the wallet offers Slovak and English.

  // A mock navigation object used to simulate navigation actions
  const navigation = { navigate: jest.fn() }
  // Centralizes rendering and waits for the storage-backed wallet state to settle.
  const renderRegister = async () => {
    const result = render(
      <ModalWrapper>
        <App navigation={navigation} translation={i18next} />
      </ModalWrapper>,
    )
    await act(async () => undefined)
    return result
  }

  // Test to check if the component renders correctly
  it('renders correctly', async () => {
    const { toJSON } = await renderRegister()
    expect(toJSON()).toMatchSnapshot()
  })

  // Test to check if the registration button is disabled when the pins are not equal or the terms checkbox is not checked
  it('disables the button if the pins are not equal or the terms checkbox is not checked', async () => {
    // Reuses the provider-aware renderer introduced for the migrated component.
    const { getByTestId } = await renderRegister()
    const button = getByTestId(testID.REGISTER_BUTTON)
    const firstPinInput = getByTestId(testID.FIRST_PIN_INPUT)
    const secondPinInput = getByTestId(testID.SECOND_PIN_INPUT)
    const checkbox = getByTestId(testID.TERMS_CHECKBOX)

    // Simulates user input by changing the text of the pin inputs and clicking the terms checkbox
    fireEvent.changeText(firstPinInput, '1234')
    fireEvent.changeText(secondPinInput, '5678')
    fireEvent.press(checkbox)

    expect(button).toBeDisabled()

    // Simulates user input by changing the text of the second pin input to be equal to the first pin input
    fireEvent.changeText(secondPinInput, '1234')

    // Checks if the registration button is enabled when the pins are equal and the checkbox is checked
    expect(button).toBeEnabled()

    fireEvent.press(checkbox)
    expect(button).toBeDisabled()
  })

  // Test to check if an error message is displayed when the pins are not equal
  it('renders an error message if the pins are not equal', async () => {
    // Reuses the provider-aware renderer introduced for the migrated component.
    const { getByTestId, queryAllByTestId } = await renderRegister()
    const firstPinInput = getByTestId(testID.FIRST_PIN_INPUT)
    const secondPinInput = getByTestId(testID.SECOND_PIN_INPUT)

    // Simulates user input by changing the text of the pin inputs to be different
    fireEvent.changeText(firstPinInput, '1234')
    fireEvent.changeText(secondPinInput, '5678')

    // Checks if an error message is displayed
    let messageErrorText = queryAllByTestId(testID.REGISTER_ERROR_MESSAGE)
    expect(messageErrorText).toHaveLength(1)

    // Set equal pins and ensure the error message is not displayed
    fireEvent.changeText(secondPinInput, '1234')
    messageErrorText = queryAllByTestId(testID.REGISTER_ERROR_MESSAGE)
    expect(messageErrorText).toHaveLength(0)
  })
})
