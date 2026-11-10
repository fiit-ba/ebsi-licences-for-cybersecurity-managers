// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import { BRAND } from '@shared/constants/brand'
import localeSK from '@features/verification/screens/Verify/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Verify a license',
  TAB: 'Verify',
  INTRO: `Ask the holder to scan this QR code in their ${BRAND.NAME} app with the Scan button on the Licenses tab, and to confirm the presentation.`,
  CONNECTING: 'Connecting to the verification service…',
  WAITING: 'Waiting for the holder…',
  REQUEST_UNTIL: 'The request is valid until {{time}}.',
  EXPIRED: 'The request expired without an answer. Create a new one.',
  DECLINED: 'The holder declined the request in their wallet.',
  NEW_REQUEST: 'New request',
  VERIFY_ANOTHER: 'Verify another license',
  RETRY: 'Try again',
  QR_LABEL: 'QR code with the presentation request',
  NOT_CONFIGURED:
    'Verification is not set up in this version of the app: the address of the verification service is missing.',
  ERROR_REQUEST: 'The presentation request could not be created',
  ERROR_RESULT: 'The verification result could not be loaded',
  RECORDED: 'The verification is recorded in the history.',
  NOT_RECORDED: 'The verification could not be recorded in the history.',
  NOT_RECORDED_GUEST: 'Without signing in to a wallet, the verification is not stored anywhere.',

  OFFLINE_SCAN: "Scan the holder's QR code",
  OFFLINE_HINT:
    "Without the server: the holder taps Present on the Licenses tab and shows a QR code. The phones connect straight over the Wi-Fi, and the license is checked in EBSI's registries and the contract.",
  OFFLINE_TITLE: 'Verification without the server',
  OFFLINE_VERIFIER_NAME: 'A verifier with the {{brand}} app',
  OFFLINE_ASKING: 'Asking for the license…',
  OFFLINE_WAITING: 'Waiting for the holder to agree…',
  OFFLINE_CHECKING: "Checking in EBSI's registries and the contract…",
  OFFLINE_DECLINED: 'The holder declined to share.',
  OFFLINE_EXPIRED: 'The exchange ended without an answer. Ask the holder for a new QR code.',
  OFFLINE_FAILED:
    "The holder's phone could not be reached. Both phones must be on the same Wi-Fi network, and the holder's QR code is valid for only 2 minutes.",
  OFFLINE_NOT_CONFIGURED:
    "Verification without the server is not set up in this version: the address of EBSI's registries or of the contract is missing.",
  OFFLINE_INVALID_QR: 'This QR code is not an invitation to present a license.',
  OFFLINE_MISSING_FIELDS: 'Required data missing: {{fields}}',
  OFFLINE_SCAN_AGAIN: 'Scan another QR code',

  CERTIFICATE_N: 'License {{n}} of {{count}}',
  PRESENTED_DATA: 'Presented data',
  ATTRIBUTES_UNTIL: 'The data is shown until {{time}}, then deleted (component 1.2).',
  ATTRIBUTES_BAD_SIGNATURE: 'Not shown — the signature is invalid, so the data cannot be attributed to the issuer.',
  ATTRIBUTES_NOT_HOLDER: 'Not shown — the license was not presented by its holder.',
  ATTRIBUTES_GONE: 'No longer shown — they are kept only briefly after verification (component 1.2).',
  ATTRIBUTES_NOT_REACHED: 'Not shown — the verification did not reach them.',
  VALID_FROM: 'Valid from',
  VALID_UNTIL: 'Valid until',
  ISSUER: 'Issuer',
  // The TI that issued it, judged at issuance (design decisions D23).
  CERTIFICATION_BODY: 'Certification body (TI)',
  ACCREDITED_AT_ISSUANCE: 'TI accreditation at issuance',
  ACCREDITED_AT_ISSUANCE_YES: 'in force — issued by an accredited body',
  ACCREDITED_AT_ISSUANCE_NO: 'not in force',
  ACCREDITED_AT_ISSUANCE_UNKNOWN: 'unknown (issued before TIs were recorded)',
  ACCREDITATION_ENDED_SINCE:
    "The TI's accreditation has ended since ({{date}}); licenses issued while it was in force stay valid until they expire.",
  // Revoked since (D24): the certificate is withdrawn
  ACCREDITATION_REVOKED: "This TI's accreditation was revoked on {{date}} — the licenses it issued are withdrawn.",
  ACCREDITATION_REVOKED_TAO:
    'The accreditation of the TAO {{organization}} that selected this TI was revoked on {{date}} — the licenses the TI issued are withdrawn.',
  VERIFIED_AT: 'Verified',
  SHOW_DETAILS: 'Show verification details',
  HIDE_DETAILS: 'Hide verification details',
  CONDITIONS: 'Conditions of validity (6.3)',
  CONDITIONS_HINT:
    'The result is VALID only if all of them hold; “—” means the verification did not reach the condition.',
  TRUST_CHAIN: 'Accreditation chain (TIR)',
  ROLE_TI: 'TI (issuer)',
  ROLE_ROOT: 'trusted root',
  LEDGER: 'Record on the governance contract',
  LEDGER_STANDING: 'Standing',
  LEDGER_NUMBER: 'License number',
  LEDGER_REGISTERED: 'Recorded',
  LEDGER_CHANGED: 'Last changed',
  LEDGER_CONTRACT: 'Contract',
  STANDING_valid: 'valid',
  STANDING_suspended: 'suspended',
  STANDING_revoked: 'revoked',
  STANDING_none: 'no record',
  NOT_EVALUATED: 'Not evaluated — the verification stopped earlier.',

  STATE_VALID: 'Valid',
  STATE_VALID_TEXT: 'The license is valid: all conditions of 6.3 are met.',
  STATE_INVALID: 'Not valid',
  STATE_INVALID_TEXT: "The license is not valid: its issuer suspended or revoked it (the contract's record).",
  STATE_SUSPENDED: 'Suspended',
  STATE_SUSPENDED_TEXT:
    'The license is suspended. Suspension is reversible, but while it lasts the license is not valid.',
  STATE_REVOKED: 'Revoked',
  STATE_REVOKED_TEXT: 'The license has been revoked. Revocation is permanent.',
  STATE_EXPIRED: 'Expired',
  STATE_EXPIRED_TEXT: 'The license has expired (validUntil).',
  STATE_NOT_YET_VALID: 'Not yet valid',
  STATE_NOT_YET_VALID_TEXT: 'The license is not valid yet (validFrom).',
  STATE_UNTRUSTED_ISSUER: 'Untrusted issuer',
  STATE_UNTRUSTED_ISSUER_TEXT:
    'The issuer is not trusted: the accreditation chain in the TIR is missing or invalid, or the certification body was not accredited when it issued the license.',
  STATE_INVALID_SIGNATURE: 'Invalid signature',
  STATE_INVALID_SIGNATURE_TEXT: "The license's signature is invalid or the key does not belong to the issuer.",
  STATE_STATUS_UNAVAILABLE: 'Status unavailable',
  STATE_STATUS_UNAVAILABLE_TEXT:
    "The status cannot be determined reliably: the license's record on the contract is unavailable or not written yet. This never means “valid”.",
  STATE_INDETERMINATE: 'Indeterminate',
  STATE_INDETERMINATE_TEXT: 'The verification cannot be completed. The result is not “valid”.',

  COND_presentation_valid: 'the VP is valid (nonce, audience, replay protection)',
  COND_signature_valid: 'the VC signature is valid',
  COND_issuer_key_valid: 'the issuer DID resolves and the key is valid',
  COND_issuer_accredited: "the issuer's accreditation is valid for this credential type",
  COND_schemas_valid: 'the credential matches both schemas',
  COND_time_valid: 'the VC is within its validity period',
  COND_holder_bound: 'holder binding is verified',
  COND_disclosures_valid: 'what was shared matches what the issuer signed',
  COND_status_available: "the license's record on the contract is available",
  COND_record_matches: "the contract's record is this license's (TI, number, id, validity)",
  COND_standing_valid: 'the contract records the license as valid',
}

export default localeEN
