// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/registration/screens/Register/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'License holder registration',
  SUBTITLE: 'Secure the app by creating a PIN',
  PIN_LABEL: 'Access PIN',
  SECOND_PIN_LABEL: 'Repeat the PIN',
  LOGIN: 'Sign in',
  PIN: 'Create an access PIN',
  SECOND_PIN: 'Repeat the PIN',
  CONDITIONS: 'I agree to the terms of use',
  RECOVERY: 'Recover access',
  BUTTON: 'Get started',
  LOADING: 'Creating the user...',
  ERROR: 'The PINs do not match',
  ERROR_PIN_LENGTH: 'The PIN must have 4 characters',
  ERROR_SAVE: 'Saving the DID failed, please try again',
  CREATING_DID: 'Creating the digital identity...',
  QR_SUBTITLE:
    "Visit the organisation's office and ask for a digital identity. They will generate a QR code to link it with your phone",
  MESSAGE_ERROR_WALLET_CREATION: 'Creating the wallet failed',
  MESSAGE_SUCCESS_WALLET_CREATION: 'The wallet has been created',
  OR: 'or',
  VERIFY_ONLY: 'Verify a license',
  VERIFY_HINT: 'No registration is needed to verify a license.',
  ORG_ENTRY: 'For organisations',
  RESTORE: 'Restore from the security phrase',
}

export default localeEN
