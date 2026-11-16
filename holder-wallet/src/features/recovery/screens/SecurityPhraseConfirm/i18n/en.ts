// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/recovery/screens/SecurityPhraseConfirm/i18n/sk'

const localeEN: typeof localeSK = {
  CONFIRM_TITLE: 'Confirm the recovery phrase',
  CONFIRM_BUTTON: 'Confirm',
  ERROR: 'Incorrect recovery phrase!',
  INPUT_LABEL: 'Enter the recovery phrase',
  INPUT_PLACEHOLDER: 'Tap the words in the right order to build the phrase',
  RESET_BUTTON: 'Clear',
  GO_BACK: 'Back',
}

export default localeEN
