// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/recovery/screens/SecurityPhrase/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Recovery phrase',
  SUBTITLE:
    'This phrase lets you recover your account if you lose access. Memorise it or keep it somewhere safe. You can show it again at any time once signed in. For your security, never share it with anyone.',
  HIDDEN_TITLE: 'Tap to show the recovery phrase',
  LONG_PRESS: 'Press and hold to copy the phrase',
  BUTTON: 'Continue',
  CONFIRM_TITLE: 'Confirm the recovery phrase',
  CONFIRM_BUTTON: 'Confirm',
  ERROR: 'Incorrect recovery phrase',
  INPUT_LABEL: 'Enter the recovery phrase',
  GO_BACK: 'Back',
  INPUT_PLACEHOLDER: 'Tap the words in the right order to build the phrase',
}

export default localeEN
