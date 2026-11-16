import { accreditationDate } from '../accreditation/dates.ts';
import { trimIdentityField } from '../identity/input-text.ts';

/** Field-oriented refusal produced by the existing issuance request serializer. */
export class IssuanceInputError extends Error {
  readonly status = 400;
  readonly body: Record<string, unknown>;

  /**
   * Retain the serializer's public field errors without inventing a domain reason.
   * @param body - Field names and existing validation messages.
   */
  constructor(body: Record<string, unknown>) {
    super('Invalid issuance request.');
    this.body = body;
  }
}

/**
 * Validate the certificate request before authority, normalization or external effects.
 * @param input - Untrusted JSON request from Back Office or the organization Wallet.
 * @returns Normalized holder reference and optional validity dates.
 * @throws IssuanceInputError with the existing serializer's field-oriented refusals.
 */
export function issuanceInput(input: Record<string, unknown>) {
  const errors: Record<string, unknown> = {};
  let holder = '';
  for (const [field, required] of [
    ['holder_reference', true],
    ['issuer_did', false],
  ] as const) {
    const value = input[field];
    let text = '';
    if (value === undefined && required) errors[field] = ['This field is required.'];
    else if (value === null) errors[field] = ['This field may not be null.'];
    else if (value !== undefined) {
      if (typeof value !== 'string' && typeof value !== 'number')
        errors[field] = ['Not a valid string.'];
      else {
        text = trimIdentityField(String(value));
        if (!text) errors[field] = ['This field may not be blank.'];
        else if (Array.from(text).length > 255)
          errors[field] = ['Ensure this field has no more than 255 characters.'];
        else if (text.includes('\0')) errors[field] = ['Null characters are not allowed.'];
        else {
          const surrogates = Array.from(
            new Set(
              Array.from(text)
                .map((character) => character.codePointAt(0)!)
                .filter((code) => code >= 0xd800 && code <= 0xdfff),
            ),
          ).sort((left, right) => left - right);
          if (surrogates.length)
            errors[field] = [
              'Surrogate characters are not allowed: ' +
                surrogates.map((code) => 'U+' + code.toString(16).toUpperCase()).join(', ') +
                '.',
            ];
        }
      }
    }
    if (field === 'holder_reference') holder = text;
  }
  const claims = input.claims;
  if (claims === undefined) errors.claims = ['This field is required.'];
  else if (claims === null) errors.claims = ['This field may not be null.'];
  else if (typeof claims !== 'object' || Array.isArray(claims))
    errors.claims = [
      `Expected a dictionary of items but got type "${Array.isArray(claims) ? 'list' : typeof claims === 'string' ? 'str' : typeof claims === 'boolean' ? 'bool' : 'int'}".`,
    ];
  else if (!Object.keys(claims).length)
    errors.claims = [
      "Certificate attributes are required; an empty credential says nothing about the holder's competence.",
    ];
  else if (Object.hasOwn(claims, 'id'))
    errors.claims = [
      "credentialSubject.id is the holder's DID and is set by the Issuer Service when the offer is redeemed.",
    ];

  if (input.credential_types !== undefined) {
    if (input.credential_types === null) errors.credential_types = ['This field may not be null.'];
    else if (!Array.isArray(input.credential_types))
      errors.credential_types = [
        `Expected a list of items but got type "${typeof input.credential_types === 'string' ? 'str' : 'dict'}".`,
      ];
    else {
      const entries: Record<string, string[]> = {};
      input.credential_types.forEach((value, index) => {
        if (value === null) entries[index] = ['This field may not be null.'];
        else if (typeof value !== 'string' && typeof value !== 'number')
          entries[index] = ['Not a valid string.'];
        else if (!trimIdentityField(String(value)))
          entries[index] = ['This field may not be blank.'];
        else if (Array.from(trimIdentityField(String(value))).length > 255)
          entries[index] = ['Ensure this field has no more than 255 characters.'];
      });
      if (Object.keys(entries).length) errors.credential_types = entries;
    }
  }
  const dates = { valid_from: null as Date | null, valid_until: null as Date | null };
  for (const field of ['valid_from', 'valid_until'] as const) {
    if (input[field] == null) continue;
    const value = accreditationDate(input[field]);
    if (!value)
      errors[field] = [
        'Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].',
      ];
    else dates[field] = value;
  }
  if (Object.keys(errors).length) throw new IssuanceInputError(errors);
  if (dates.valid_from && dates.valid_until && dates.valid_until <= dates.valid_from)
    throw new IssuanceInputError({ non_field_errors: ['valid_until must be after valid_from.'] });
  if (dates.valid_until && +dates.valid_until <= Date.now())
    throw new IssuanceInputError({ valid_until: ['valid_until must be in the future.'] });
  return { holder, ...dates };
}
