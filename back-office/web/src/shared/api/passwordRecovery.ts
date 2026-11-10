import { backendRequest } from './client.ts';

/** Existing generic recovery response, deliberately omitting account and token details. */
export type RecoveryResponse = { status: 'OK' };

/**
 * Request a reset email using the existing unauthenticated endpoint.
 * @param email - Account email supplied by the user.
 * @returns The generic acknowledgement for known and unknown accounts.
 * @throws Existing backend validation, throttling or network refusals.
 */
export async function requestPasswordReset(email: string): Promise<RecoveryResponse> {
  return backendRequest('/api/password_reset/', { method: 'POST', auth: false, body: { email } });
}

/**
 * Check a private reset token without exposing or persisting account details.
 * @param token - Bearer value from the recovery link.
 * @returns The existing validation acknowledgement.
 * @throws Existing invalid/expired-token or network refusals.
 */
export async function validatePasswordReset(token: string): Promise<RecoveryResponse> {
  return backendRequest('/api/password_reset/validate_token/', {
    method: 'POST',
    auth: false,
    body: { token },
  });
}

/**
 * Consume the reset token and set the new password through the existing endpoint.
 * @param token - One-time bearer value from the recovery link.
 * @param password - New plaintext password, sent only in the request body.
 * @returns The acknowledgement after the server commits the password change.
 * @throws Existing weak-password, invalid-token or network refusals.
 */
export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<RecoveryResponse> {
  return backendRequest('/api/password_reset/confirm/', {
    method: 'POST',
    auth: false,
    body: { token, password },
  });
}
