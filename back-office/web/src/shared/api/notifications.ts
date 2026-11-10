// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * What awaits the signed-in user, asked once when they sign in: the open
 * requests to suspend, revoke or reinstate a certificate in their scope, the
 * newest first, and how many there are (`total`).
 * @returns The newest visible open cases and full total/waiting counts.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function notifications() {
  return backendRequest('/registry/notifications/');
}
