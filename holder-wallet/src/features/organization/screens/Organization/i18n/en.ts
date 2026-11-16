// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/organization/screens/Organization/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Organisation',
  INTRO:
    'Certification bodies (TIs) issue licenses straight from the app. A TAO first selects the organisation and gives it an invitation; with it you register here, and sign in afterwards.',
  TAB_SIGN_IN: 'Sign in',
  TAB_REGISTER: 'Register',
  USERNAME: 'Username',
  PASSWORD: 'Password',
  PASSWORD_AGAIN: 'Repeat the password',
  INVITATION: 'Invitation from the TAO',
  SIGN_IN: 'Sign in',
  SIGN_IN_HINT:
    "Next you choose the organisation profile's PIN. The organisation's profile stands on its own: it has its own PIN, needs no security phrase and leaves the license holder's wallet alone.",
  PIN_TITLE: 'Organisation profile PIN',
  PIN_TEXT:
    "Signed in as {{username}}. Choose the PIN that unlocks the organisation's profile on this device. It can differ from the license holder's PIN.",
  PIN: 'Organisation PIN',
  PIN_AGAIN: 'Repeat the PIN',
  CREATE_PROFILE: 'Create profile',
  PIN_HINT:
    "The organisation's profile and the license holder's wallet are independent: delete one and the other stays. The back-office password is not stored on the device.",
  PIN_SHORT: 'The PIN needs at least 4 digits.',
  PINS_DIFFER: 'The PINs do not match.',
  REGISTER: 'Register and sign in',
  REGISTER_HINT:
    'The organisation gets the invitation from the TAO that selected it as a TI. It works once; if it has expired, ask the TAO for a new one.',
  FILL_ALL: 'Fill in all the fields.',
  PASSWORDS_DIFFER: 'The passwords do not match.',
  NOT_CONFIGURED: 'The app has no registry address set up.',

  ERROR_CREDENTIALS: 'Wrong username or password.',
  ERROR_NOT_ISSUER: 'This account may not issue licenses. TAOs and the RootTAO work in the back-office console.',
  ERROR_USERNAME_TAKEN: 'This username is already taken.',
  ERROR_WEAK_PASSWORD: 'The password is not strong enough.',
  ERROR_INVALID_FIELDS: 'Please check: {{fields}}.',
  ERROR_INVALID_INVITATION:
    'The invitation is not valid: it is wrong, already used or expired. Ask the TAO that selected you for a new one.',
  ERROR_WRONG_KIND: 'This invitation is for a TAO. A TAO registers in the back-office console, not in the app.',
  ERROR_NOT_TI: 'Only a TI selected by a TAO may issue. This account is not a TI in the trust chain.',
  ERROR_SCHEMA_NOT_ACCREDITED: 'Your TI is not accredited to issue this kind of license. Your TAO can give it to you.',
  ERROR_INVALID_CLAIMS: 'The license does not fit the scheme. Check the highlighted fields.',
  ERROR_TOO_MANY: 'Too many attempts from this network. Try again later.',
  ERROR_SIGNED_OUT: "The organisation's sign-in has expired. Please sign in again.",
  ERROR_NOT_ACCREDITED: "The registry cannot issue right now: the issuer's accreditation is not confirmed.",
  // The TI issues under its own DID (design decisions D27).
  ERROR_NOT_ONBOARDED:
    'Your TI is not set up in EBSI as an issuer with its own DID yet. Try again later or contact the registry operator.',
  // A TI's accreditation has an end (design decisions D23).
  ERROR_ACCREDITATION_EXPIRED:
    "Your TI's accreditation ended on {{date}}. You can no longer issue new licenses; licenses issued while it was accredited stay valid until they expire. Ask your TAO to renew it.",
  ERROR_ACCREDITATION_EXPIRED_UNDATED:
    "Your TI's accreditation has ended. You can no longer issue new licenses; licenses issued while it was accredited stay valid until they expire. Ask your TAO to renew it.",
  // Its accreditation was revoked (D24): its own, or its TAO's
  ERROR_ACCREDITATION_REVOKED:
    "Your TI's accreditation was revoked on {{date}}. You can no longer sign in, and the licenses you issued have been withdrawn.",
  ERROR_ACCREDITATION_REVOKED_TAO:
    "The accreditation of the TAO that selected your TI was revoked on {{date}}, and your TI's authority with it. You can no longer sign in, and the licenses you issued have been withdrawn.",
  ACCREDITED_UNTIL: 'The TI is accredited until {{date}}.',
  ACCREDITATION_ENDED:
    "The TI's accreditation ended on {{date}} — you can verify and view the history in the app, but not issue.",
  ACCREDITATION_ENDED_UNDATED:
    "The TI's accreditation has ended — you can verify and view the history in the app, but not issue.",
  ERROR_ISSUE_INVALID: "The registry refused the license's details. Please check them.",
  PASSWORD_password_too_short: 'The password must have at least 15 characters.',
  PASSWORD_password_too_long: 'The password must have at most 128 characters.',
  PASSWORD_password_too_weak: 'Choose a less predictable password or a longer phrase with unrelated words.',
  FIELD_invitation: 'invitation',
  FIELD_username: 'username',
  FIELD_password: 'password',
}

export default localeEN
