// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';
import { SESSION_EXPIRED, currentUser, rememberSession, signedIn, signOut } from './session.ts';

export { SESSION_EXPIRED, currentUser, signedIn, signOut };

/**
 * Authenticate the operator and retain the existing access session after a successful response.
 * @param username - Operator username.
 * @param password - Operator password supplied for the existing authentication or registration request.
 * @returns The existing token response after retaining its access token in the current tab.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export async function signIn(username, password) {
  const data = await backendRequest('/api/api-token-auth', {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
  rememberSession(username, data.access);
  return data;
}

/**
 * Who is signed in and which roles they hold (component 1).
 * @returns The existing current profile, roles, organization and governance contract.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function me() {
  return backendRequest('/registry/me/');
}
