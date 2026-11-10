import { trimIdentityField } from '../identity/input-text.ts';

/** Validated public registration fields, retaining the caller's exact password. */
interface RegistrationFields {
  invitation: string;
  username: string;
  password: string;
  kind?: 'tao' | 'ti';
}

/**
 * Validate character fields with bounded length, text coercion and optional whitespace trimming.
 * @param value - Untrusted JSON field; booleans, containers and null are not text.
 * @param maximum - Maximum Unicode code-point length after optional trimming.
 * @param trim - Whether the serializer trims this field.
 * @returns A nonblank bounded string, or undefined for invalid input.
 */
function characterField(value: unknown, maximum: number, trim: boolean): string | undefined {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return;
  const text = trim ? trimIdentityField(String(value)) : String(value);
  return text && Array.from(text).length <= maximum ? text : undefined;
}

/**
 * Validate the existing console/wallet registration payload without accessing storage.
 * @param input - Untrusted invitation, username, password and optional organization kind.
 * @returns Normalized invitation/username with the exact password, or sorted invalid field names.
 * @remarks Punctuation-only invitations are InvalidInvitation (404), not invalid fields (400).
 */
export function registrationInput(
  input: Record<string, unknown>,
): { fields: string[]; value?: undefined } | { fields?: undefined; value: RegistrationFields } {
  const invitation = characterField(input.invitation, 64, true);
  const username = characterField(input.username, 150, true);
  const password = characterField(input.password, 128, false);
  const fields: string[] = [];
  if (invitation === undefined) fields.push('invitation');
  if (username === undefined || !/^[\p{L}\p{N}@.+_-]+$/u.test(username)) fields.push('username');
  if (password === undefined) fields.push('password');
  if (
    input.kind !== undefined &&
    (typeof input.kind !== 'string' || !['tao', 'ti'].includes(input.kind))
  )
    fields.push('kind');
  if (fields.length) return { fields: fields.sort() };
  return {
    value: {
      invitation: invitation!.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      username: username!,
      password: password!,
      ...(input.kind === undefined ? {} : { kind: input.kind as 'tao' | 'ti' }),
    },
  };
}
