/** Public synthetic registration cases for the current HTTP contract. */
export interface RegistrationCase {
  name: string;
  scenario?:
    'ti' | 'expired_invitation' | 'expired_accreditation' | 'revoked_parent' | 'registered';
  changes?: Record<string, unknown>;
  invitation?: 'unknown' | 'punctuation' | 'blank' | 'padded' | 'decorated' | 'lowercase';
  status: number;
  reason?: string;
  fields?: string[];
  codes?: string[];
}

/** Existing serializer, refusal priority and one-time invitation acceptance requirements. */
export const registrationCases: readonly RegistrationCase[] = [
  { name: 'tao', status: 201 },
  { name: 'ti', scenario: 'ti', changes: { kind: 'ti' }, status: 201 },
  { name: 'unknown', invitation: 'unknown', status: 404, reason: 'InvalidInvitation' },
  { name: 'punctuation', invitation: 'punctuation', status: 404, reason: 'InvalidInvitation' },
  {
    name: 'blank',
    invitation: 'blank',
    status: 400,
    reason: 'InvalidFields',
    fields: ['invitation'],
  },
  { name: 'trimmed', invitation: 'padded', status: 201 },
  { name: 'decorated', invitation: 'decorated', status: 201 },
  { name: 'lowercase', invitation: 'lowercase', status: 201 },
  { name: 'wrongkind', changes: { kind: 'ti' }, status: 409, reason: 'WrongKind' },
  {
    name: 'badkind',
    changes: { kind: { toString: null } },
    status: 400,
    reason: 'InvalidFields',
    fields: ['kind'],
  },
  {
    name: 'boolkind',
    changes: { kind: true },
    status: 400,
    reason: 'InvalidFields',
    fields: ['kind'],
  },
  {
    name: 'expired',
    scenario: 'expired_invitation',
    changes: { kind: 'ti' },
    status: 404,
    reason: 'InvalidInvitation',
  },
  { name: 'ended', scenario: 'expired_accreditation', status: 404, reason: 'InvalidInvitation' },
  {
    name: 'endedwrongkind',
    scenario: 'expired_accreditation',
    changes: { kind: 'tao' },
    status: 409,
    reason: 'WrongKind',
  },
  { name: 'revoked', scenario: 'revoked_parent', status: 404, reason: 'InvalidInvitation' },
  { name: 'registered', scenario: 'registered', status: 404, reason: 'InvalidInvitation' },
  {
    name: 'duplicate',
    changes: { username: 'OCCUPIED', password: 'password' },
    status: 409,
    reason: 'UsernameTaken',
  },
  {
    name: 'weak',
    changes: { password: 'password' },
    status: 400,
    reason: 'WeakPassword',
    codes: ['password_too_short'],
  },
  {
    name: 'longpassword',
    changes: { password: '🔐'.repeat(129) },
    status: 400,
    reason: 'InvalidFields',
    fields: ['password'],
  },
  {
    name: 'unicodepassword',
    changes: { password: '🔐'.repeat(128) },
    status: 400,
    reason: 'WeakPassword',
    codes: ['password_too_weak'],
  },
  { name: 'unicode-trim', changes: { username: '\u0085unicode.user\u0085' }, status: 201 },
  {
    name: 'bom',
    changes: { username: '\ufeffnot.trimmed' },
    status: 400,
    reason: 'InvalidFields',
    fields: ['username'],
  },
  { name: 'numericuser', changes: { username: 1234567890 }, status: 201 },
  {
    name: 'nullpassword',
    changes: { password: null },
    status: 400,
    reason: 'InvalidFields',
    fields: ['password'],
  },
  {
    name: 'booleanuser',
    changes: { username: true },
    status: 400,
    reason: 'InvalidFields',
    fields: ['username'],
  },
];

/**
 * Build a case payload using its own freshly issued invitation.
 * @param item - Registration input case and its expected response.
 * @param invitation - Valid fixture invitation for this exact case.
 * @returns Synthetic registration payload sent to the API.
 */
export function registrationPayload(
  item: RegistrationCase,
  invitation: string,
): Record<string, unknown> {
  const transformed =
    item.invitation === 'unknown'
      ? 'ZZZZ-YYYY-XXXX'
      : item.invitation === 'punctuation'
        ? '---'
        : item.invitation === 'blank'
          ? '   '
          : item.invitation === 'padded'
            ? ' '.repeat(40) + invitation + ' '.repeat(40)
            : item.invitation === 'decorated'
              ? invitation + '汉'
              : item.invitation === 'lowercase'
                ? invitation.toLowerCase()
                : invitation;
  return {
    invitation: transformed,
    username: 'registration.case.' + item.name,
    password: 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3',
    ...item.changes,
  };
}
