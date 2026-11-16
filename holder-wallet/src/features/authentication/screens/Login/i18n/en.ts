// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/authentication/screens/Login/i18n/sk'

const localeEN: typeof localeSK = {
  REGISTER_LINK: 'Create a new wallet',
  TITLE: 'License holder login',
  PIN_LABEL: 'Access PIN',
  PIN: 'Enter your PIN to unlock your wallet.',
  RECOVERY: 'Recover access',
  BUTTON: 'Unlock',
  ERROR: 'Incorrect PIN',
  NO_WALLET: 'No wallet has been created yet. Create one first.',
  REPLACE_TITLE: 'Create a new wallet?',
  REPLACE_TEXT: 'The new wallet replaces this one, including its keys and all its licenses.',
  REPLACE_CONFIRM: 'Create new',
  CANCEL: 'Cancel',
  ORG_TITLE: 'Organisation login',
  ORG_PIN: "Enter the organisation profile's PIN.",
  SIGN_IN_AS_ORG: 'Sign in as an organisation',
  SWITCH_TO_HOLDER: 'Switch to license holder',
  LINK_NEEDS_HOLDER: "Only the license holder's wallet takes and presents licenses. Create it and open the link again.",
  VERIFY: 'Verify a license without signing in',
  // An organisation whose accreditation was revoked (D24)
  REVOKED_TITLE: 'Accreditation revoked',
  REVOKED_TEXT:
    "This organisation's accreditation was revoked on {{date}}. It can no longer sign in, and the licenses it issued have been withdrawn.",
  REVOKED_TEXT_TAO:
    'The accreditation of the TAO that selected this organisation was revoked on {{date}}, and its authority with it. It can no longer sign in, and the licenses it issued have been withdrawn.',
  REMOVE_PROFILE: 'Remove the organisation profile from this device',
  REMOVE_TITLE: 'Remove the organisation profile?',
  REMOVE_TEXT:
    "The organisation profile and its history are removed from this device. The license holder's wallet stays.",
  REMOVE_CONFIRM: 'Remove',
}

export default localeEN
