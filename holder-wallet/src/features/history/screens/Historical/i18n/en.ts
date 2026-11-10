// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/history/screens/Historical/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'History',
  PLACEHOLDER_TITLE: 'History',
  PLACEHOLDER_TEXT: 'The history of what you did in the wallet appears here.',
  CREDENTIAL_DETAILS_ISSUER: 'Organisation',
  DATE: 'Date',
  CREDENTIAL_ADDED: 'License added',
  CREDENTIAL_EXPIRED: 'License expired',
  PRESENTATION_EMITTED: 'Presentation made',
  CREDENTIAL_REVOKED: 'License revoked',
  CREDENTIAL_SUSPENDED: 'License suspended',
  CREDENTIAL_REINSTATED: 'License reinstated',
  PRESENTATION_REVOKED: 'Access revoked',
  DEFAULT_MESSAGE: 'Unknown action',
  CERTIFICATE_VERIFIED: 'License verification',
  RESULT: 'Result',
  CERTIFICATE_ISSUED: 'License issued',
  KIND: 'Kind',
  ORGANISATION_COPIED: 'Organisation copied',
  COPY_ORGANISATION_HINT: 'Long press to copy the full organisation identifier',
}

export default localeEN
