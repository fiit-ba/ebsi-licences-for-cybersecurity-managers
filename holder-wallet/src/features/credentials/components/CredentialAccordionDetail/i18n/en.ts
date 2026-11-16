// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/components/CredentialAccordionDetail/i18n/sk'

const localeEN: typeof localeSK = {
  ID: 'ID: ',
  CREDENTIAL: 'License: ',
  ORGANIZATION: 'Organisation: ',
  TRUSTED_FRAMEWORK: 'Network: ',
  ISSUANCE_DATE: 'Issued on: ',
  VALID_FROM: 'Valid from: ',
  VALID_UNTIL: 'Valid until: ',
  STATUS: 'Status: ',
  VALID: 'Valid',
  REVOKED: 'Revoked',
  SUSPENDED: 'Suspended',
  UNDETERMINED: 'Undetermined',
  ADDITIONAL_INFO: 'License details: ',
  COPY_HINT: 'Long press any value to copy it in full',
}

export default localeEN
