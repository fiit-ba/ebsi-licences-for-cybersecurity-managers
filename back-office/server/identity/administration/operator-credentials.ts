import { OperatorManagementError } from './management-error.ts';
import { passwordPolicyCodes } from '../auth/password-policy.ts';

/**
 * Validate operator credentials without deriving or exposing a password hash.
 * @param input - Untrusted username, email and optional password.
 * @param requirePassword - Whether an initial password is mandatory.
 * @returns Normalized username/email and the supplied password, if any.
 * @throws OperatorManagementError for malformed credentials or weak passwords.
 */
export function operatorCredentials(input: Record<string, unknown>, requirePassword: boolean) {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (
    !/^[\p{L}\p{N}@.+_-]{1,150}$/u.test(username) ||
    email.length > 254 ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
    (input.email !== undefined && typeof input.email !== 'string')
  ) {
    throw new OperatorManagementError(400, 'InvalidFields', 'Enter a valid username and email.');
  }
  const password = input.password;
  if (
    (requirePassword || password !== undefined) &&
    (typeof password !== 'string' || passwordPolicyCodes(password, { username, email }).length > 0)
  ) {
    throw new OperatorManagementError(
      400,
      'WeakPassword',
      'Use 15 to 128 characters and choose a less predictable password or a phrase with unrelated words.',
    );
  }
  return { username, email, password: password as string | undefined };
}
