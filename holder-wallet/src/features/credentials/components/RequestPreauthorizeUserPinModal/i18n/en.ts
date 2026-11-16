// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/components/RequestPreauthorizeUserPinModal/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'PIN',
  DESCRIPTION: 'Enter the PIN you received from the certification body with the license offer.',
  PIN_LABEL: 'Offer PIN',
  REQUEST: 'Confirm',
}

export default localeEN
