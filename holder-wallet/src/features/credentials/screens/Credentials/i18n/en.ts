// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/screens/Credentials/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Licenses',
  PlACEHOLDER_TITLE: 'Welcome',
  PlACEHOLDER_TEXT:
    'This wallet keeps your licenses of professional competence safe. Ask the certification body for a license; it will send you the details by e-mail. You then store the license right in the app, or add it quickly by scanning a QR code.',
  BUTTON_SCAN: 'Scan',
  BUTTON_PRESENT: 'Present to a verifier',
  BUTTON_MAILBOX: 'Refresh licenses',
  BUTTON_MAILBOX_SUCCESS: 'The license list has been refreshed',
  CREDENTIAL_DETAILS_ISSUER: 'Organisation: ',
  CREDENTIAL_DETAIL_TYPE: 'License: ',
  CREDENTIAL_DETAIL_STATUS: 'Status: ',
  CREDENTIAL_REFERENCE: 'Number: ',
  ISSUANCE_DATE: 'Issued on: ',
  EXPIRES: 'Valid until: ',
  NEVER: 'Never',
  NOT_AVAILABLE: 'Not available',
  STATE: 'Status: ',
  STATE_SUSPENDED: 'Suspended',
  STATE_REVOKED: 'Revoked',
}

export default localeEN
