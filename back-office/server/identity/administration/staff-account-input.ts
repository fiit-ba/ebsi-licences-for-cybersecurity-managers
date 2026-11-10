import { trimIdentityField } from '../input-text.ts';
import { passwordPolicyCodes } from '../auth/password-policy.ts';
import { OperatorManagementError } from './management-error.ts';
import type { StaffAccount } from '../../../shared/staff-accounts.ts';
import { maxPasswordBytes } from '../auth/passwords.ts';

/** Validated full-state staff edit, with an optional explicit password replacement. */
export interface StaffAccountInput {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  group_ids: number[];
  permission_ids: number[];
  password?: string;
}

/**
 * Parse distinct positive IDs without accepting strings, unknown grants or oversized arrays.
 * @param value - Untrusted list of group or permission IDs.
 * @returns Sorted distinct IDs.
 * @throws OperatorManagementError for a malformed list.
 */
function membershipIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    value.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)
  )
    throw new OperatorManagementError(
      400,
      'InvalidFields',
      'Supply valid group and permission IDs.',
    );
  return [...new Set(value as number[])].sort((first, second) => first - second);
}

/**
 * Validate a staff account edit against the existing username/password field rules.
 * @param input - Untrusted create/update fields.
 * @param current - Locked account for updates; omitted for new account creation.
 * @returns Normalized complete fields with omitted privileges preserved on updates.
 * @throws OperatorManagementError for unknown fields, invalid flags, names or passwords.
 * @remarks Existing hashes and metadata cannot be assigned through mass assignment.
 * Administrative usernames normalize NFKC; registration/login retain their own rules.
 */
export function staffAccountInput(
  input: Record<string, unknown>,
  current?: StaffAccount,
): StaffAccountInput {
  const allowed = new Set([
    'account_id',
    'version',
    'username',
    'email',
    'first_name',
    'last_name',
    'active',
    'is_staff',
    'is_superuser',
    'group_ids',
    'permission_ids',
    'password',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new OperatorManagementError(400, 'InvalidFields', 'Unknown account fields.');
  if (
    [
      'email',
      'first_name',
      'last_name',
      'active',
      'is_staff',
      'is_superuser',
      'group_ids',
      'permission_ids',
      'password',
    ].some((field) => Object.hasOwn(input, field) && input[field] === null)
  )
    throw new OperatorManagementError(400, 'InvalidFields', 'Account fields cannot be null.');
  const username =
    typeof input.username === 'string' ? trimIdentityField(input.username).normalize('NFKC') : '';
  const email = typeof input.email === 'string' ? trimIdentityField(input.email) : '';
  const firstValue = input.first_name ?? current?.first_name ?? '';
  const lastValue = input.last_name ?? current?.last_name ?? '';
  const firstName = typeof firstValue === 'string' ? trimIdentityField(firstValue) : firstValue;
  const lastName = typeof lastValue === 'string' ? trimIdentityField(lastValue) : lastValue;
  if (
    !/^[\p{L}\p{N}@.+_-]{1,150}$/u.test(username) ||
    email.length > (current ? 254 : 100) ||
    (!current && !email) ||
    (email && !/^[^\s@,;<>]+@(?:localhost|[^\s@,;<>]+\.[^\s@,;<>]+)$/iu.test(email)) ||
    typeof firstName !== 'string' ||
    (typeof firstName === 'string' && firstName.includes('\0')) ||
    Array.from(firstName).length > 150 ||
    typeof lastName !== 'string' ||
    (typeof lastName === 'string' && lastName.includes('\0')) ||
    Array.from(lastName).length > 150
  )
    throw new OperatorManagementError(
      400,
      'InvalidFields',
      'Supply a valid username, email and names.',
    );
  const active = input.active ?? current?.active ?? true;
  const isStaff = input.is_staff ?? current?.is_staff ?? false;
  const isSuperuser = input.is_superuser ?? current?.is_superuser ?? false;
  if (
    typeof active !== 'boolean' ||
    typeof isStaff !== 'boolean' ||
    typeof isSuperuser !== 'boolean'
  )
    throw new OperatorManagementError(
      400,
      'InvalidFields',
      'Account flags must be boolean values.',
    );
  const password = input.password;
  if (
    (!current || password !== undefined) &&
    (typeof password !== 'string' ||
      !password ||
      Buffer.byteLength(password) > maxPasswordBytes ||
      passwordPolicyCodes(password, { username, email, firstName, lastName }).length)
  )
    throw new OperatorManagementError(
      400,
      'WeakPassword',
      'Use a strong password distinct from the account details.',
    );
  return {
    username,
    email,
    first_name: firstName,
    last_name: lastName,
    active,
    is_staff: isStaff,
    is_superuser: isSuperuser,
    group_ids: membershipIds(input.group_ids ?? current?.group_ids ?? []),
    permission_ids: membershipIds(input.permission_ids ?? current?.permission_ids ?? []),
    ...(password === undefined ? {} : { password: password as string }),
  };
}
