import { IssuanceError } from '../issuance/claims.ts';

/**
 * Build a lifecycle refusal with its HTTP status, detail and optional field errors.
 * @param status - Existing HTTP refusal status.
 * @param body - Existing detail, field-error arrays and optional reason.
 * @returns A domain refusal understood by the existing outer HTTP boundary.
 */
export function lifecycleRefusal(status: number, body: Record<string, unknown>): IssuanceError {
  const error = new IssuanceError(status, '', String(body.detail ?? 'Invalid lifecycle request.'));
  for (const key of Object.keys(error.body)) Reflect.deleteProperty(error.body, key);
  Object.assign(error.body, body);
  return error;
}

/**
 * Normalize a credential identifier with whitespace trimming and numeric text coercion.
 * @param value - Untrusted required credential_id field.
 * @returns Trimmed string, including accepted numeric values converted to text.
 * @throws IssuanceError for absent, blank, null, malformed or overlong input.
 */
export function lifecycleIdentifier(value: unknown) {
  if (value === undefined)
    throw lifecycleRefusal(400, { credential_id: ['This field is required.'] });
  if (value === null)
    throw lifecycleRefusal(400, { credential_id: ['This field may not be null.'] });
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
    throw lifecycleRefusal(400, { credential_id: ['Not a valid string.'] });
  const text = String(value).replace(/^[\s\u0085]+|[\s\u0085]+$/gu, '');
  if (!text) throw lifecycleRefusal(400, { credential_id: ['This field may not be blank.'] });
  if (Array.from(text).length > 255)
    throw lifecycleRefusal(400, {
      credential_id: ['Ensure this field has no more than 255 characters.'],
    });
  return text;
}
