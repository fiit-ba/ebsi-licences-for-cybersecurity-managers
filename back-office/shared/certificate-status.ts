/** Supported certificate status change shared by browser and server. */
export type StatusAction = 'suspend' | 'revoke' | 'reinstate';
export const maxReasonCharacters = 500;

/** Public reason categories shared by operator forms and server validation. */
export const statusReasons: Record<StatusAction, readonly string[]> = {
  suspend: [
    'key_compromise',
    'under_investigation',
    'holder_request',
    'conditions_not_met',
    'supervisory_decision',
    'issued_in_error',
    'issuer_revoked',
    'other',
  ],
  revoke: [
    'conditions_not_met',
    'supervisory_decision',
    'holder_request',
    'key_compromise',
    'issued_in_error',
    'superseded',
    'issuer_revoked',
    'other',
  ],
  reinstate: ['none', 'resolved', 'issued_in_error', 'other'],
};
