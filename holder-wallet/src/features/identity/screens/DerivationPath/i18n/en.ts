// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/identity/screens/DerivationPath/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Derivation path',
  SUBTITLE:
    'The path is derived from your security phrase, so the phrase alone restores the wallet. Never share the path with anyone.',
  HIDDEN_TITLE: 'Tap to show the derivation path',
  LONG_PRESS: 'Press and hold to copy',
  BUTTON: 'Continue',
  GO_BACK: 'Back',
}

export default localeEN
