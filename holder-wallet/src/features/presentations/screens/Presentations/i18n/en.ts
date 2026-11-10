// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/presentations/screens/Presentations/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Presentations',
  PLACEHOLDER_TITLE: 'Presentations',
  PLACEHOLDER_TEXT:
    'Licenses you presented that are still valid appear here. You can revoke access to them, so you decide who sees your data and for how long.',
  SCAN_QR: 'Scan QR code',
  CREDENTIAL_DETAILS_ISSUER: 'Organisation',
  INFORMATION: 'Shared data',
  DATE: 'Date',
  ORGANIZATIONS: 'Organisations',
  SUCCESS_MESSAGE: 'The presentation has been revoked',
  CREDENTIAL: 'License: ',
  PRESENTED: 'Presented',
  ACTIVE_PRESENTATIONS: 'Active presentations',
  ACTIVE_COUNT: 'Records: {{count}}',
  MANAGE: 'Manage',
  CANCEL: 'Cancel',
  REVOKE: 'Revoke',
  SELECTED_COUNT: 'Selected: {{count}}',
  SELECT_ALL: 'Select all',
  ALL_SELECTED: 'All selected',
  NO_ACTIVE_PRESENTATIONS: 'There are no active presentations.',
  ERROR_MESSAGE: 'Some presentations could not be revoked. Please try again.',
  PRESENTED_AT: 'Presented {{date}}',
  VERIFIER: 'Verifier',
  PRESENTATION_ID: 'Presentation ID',
  NETWORK: 'Network',
  SHARED_CERTIFICATES: 'Shared licenses',
  LEGACY_RECORD: 'Older record – the verifier was not stored',
  UNKNOWN_CREDENTIAL: 'Unknown license type',
  DETAILS: 'Presentation details',
}

export default localeEN
