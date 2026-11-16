// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

const TOKEN_KEY = 'plr.token';
const USER_KEY = 'plr.user';

/**
 * Fired when the back-office rejects the access token.
 *
 * The token lasts 15 minutes and the back-office exposes no refresh endpoint,
 * so an expired session can only be recovered by signing in again.
 */
export const SESSION_EXPIRED = 'plr:session-expired';

/**
 * Read the operator name retained in the current tab session.
 * @returns The stored operator name, or an empty string.
 * @throws Browser session-storage access errors.
 */
export function currentUser() {
  return sessionStorage.getItem(USER_KEY) || '';
}

/**
 * Read the access token retained in the current tab session.
 * @returns The stored access token, or an empty string.
 * @throws Browser session-storage access errors.
 */
export function accessToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

/**
 * Check whether the current tab retains an operator access token.
 * @returns Whether an access token is retained.
 * @throws Browser session-storage access errors.
 */
export function signedIn() {
  return Boolean(accessToken());
}

/**
 * Retain the existing operator name and access token in this tab session.
 * @param username - Operator username.
 * @param access - Issued access token retained only in the current tab.
 * @returns No return value; the existing operation updates its owned state or storage.
 * @throws Browser session-storage access errors.
 */
export function rememberSession(username, access) {
  sessionStorage.setItem(TOKEN_KEY, access);
  sessionStorage.setItem(USER_KEY, username);
}

/**
 * Remove the existing operator access token and name from this tab session.
 * @returns No return value; the existing operation updates its owned state or storage.
 * @throws Browser session-storage access errors.
 */
export function signOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
