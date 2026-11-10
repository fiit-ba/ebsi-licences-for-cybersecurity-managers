// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/scanner/screens/QrReader/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'QR scanner',
  BACKWARD: 'Back',
  SUCCESS: 'The QR code has been read',
  ERROR: 'Invalid QR code',
  TRY: 'Try again',
  LOADING: 'Loading...',
  ISSUER: 'issuer',
  REQUEST_CREDENTIAL: 'Do you want to request a license from the issuer?',
  SUCCESS_ASOCIATE_IDENTIFIER: 'The identifier has been linked',
  PERMISSIONS_MESSAGE: 'The app needs permission to use the camera',
  SCAN_QR: 'Scan a QR code to request a license ({{issuer}}), present one or link your profile with an organisation',
}

export default localeEN
