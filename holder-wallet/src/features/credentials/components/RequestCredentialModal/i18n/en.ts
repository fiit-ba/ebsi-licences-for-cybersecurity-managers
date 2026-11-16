// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/components/RequestCredentialModal/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Request a license',
  DESCRIPTION: 'You are about to request a license from this organisation:',
  ENTITY: 'Organisation: ',
  NETWORK: 'Network: ',
  PUBLIC_KEY: 'Public key: ',
  CREDENTIAL_REQUEST_DESCRIPTION: 'Which type of license do you want to request?',
  REQUEST: 'Request',
  CANCEL: 'Cancel',
  SELECT_PLACEHOLDER: 'Choose a license type',
}

export default localeEN
