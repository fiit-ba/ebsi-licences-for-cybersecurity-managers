// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/presentations/components/RequestPresentationModal/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Present licenses',
  DESCRIPTION:
    'You have been asked to present verifiable data from your licenses. Choose below which licenses to present; the verifier sees only the data you give it. You can revoke access to presented data at any time in the list of presentations.',
  SELECT_CREDENTIAL_DESCRIPTION:
    'Choose the required number of licenses. The counter shows how many still need to be selected:',
  SELECTED_COUNT: 'Selected: {{selected}} of {{required}}',
  REQUEST_CONTINUE: 'Continue',
  REQUEST: 'Share',
  CREDENTIALS_EMPTY_STATE: 'You have no license stored. Add a license first to continue.',
  GO_BACK: 'Back',
  VALID_FROM: 'Valid from',
  ORGANIZATION: 'Organisation',
  TYPE: 'Type',
  EXPIRATION_DATE: 'Valid until',
  NEVER: 'Never',
  ALL: 'All',
  NUMBER: 'Number',
  SELECT_ONE: 'Choose the license to present:',
  CHECKING: "Checking the licenses' current status…",
  NONE_USABLE: 'None of your licenses can be presented now.',
  STATUS_SUSPENDED: 'Suspended — cannot be presented',
  STATUS_REVOKED: 'Revoked — cannot be presented',
  STATUS_EXPIRED: 'Expired on {{date}} — cannot be presented',
  STATUS_NOT_YET: 'Valid only from {{date}} — cannot be presented yet',
  STATUS_UNVERIFIED: 'The current status could not be checked — the verifier will decide',
  FIELDS_DESCRIPTION:
    'Choose what of the license you share. The verifier offers these options and sees only the attributes of the one you choose.',
  FIELDS_ALWAYS:
    'Always shared: the license number, the issuer, the schema, the validity and a reference to the certificate registry - what the verifier checks the license by.',
  OPTION_ALL: 'All the requested attributes ({{count}})',
  OPTION_REQUIRED: 'Only the required attributes ({{count}})',
  OPTION_OTHER: 'Option {{number}} ({{count}} attributes)',
  FIELDS_COUNT: 'You share {{count}} of {{total}} attributes.',
}

export default localeEN
