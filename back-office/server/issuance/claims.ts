import type { SchemaField } from '../schemas/types.ts';
import { schemaDate } from '../schemas/input.ts';
import { trimIdentityField } from '../identity/input-text.ts';
/** Public HTTP refusal from issuance or certificate lifecycle operations. */
export class IssuanceError extends Error {
  readonly status: number;
  readonly body: { reason: string; detail: string } & Record<string, unknown>;
  /**
   * Create a machine-readable issuance refusal.
   *
   * @param status - HTTP response status.
   * @param reason - Stable refusal code.
   * @param detail - Public explanation.
   * @param fields - Additional validation response fields.
   */
  constructor(status: number, reason: string, detail: string, fields = {}) {
    super(detail);
    this.status = status;
    this.body = { reason, detail, ...fields };
  }
}

/**
 * Normalize one claim according to its schema kind.
 *
 * @param kind - Text, date or positive-integer kind.
 * @param value - Untrusted field value.
 * @returns A normalized scalar, or undefined when invalid.
 */
function normalizedValue(kind: string, value: unknown) {
  if (kind === 'date') {
    if (typeof value === 'string' || typeof value === 'number') return schemaDate(String(value));
  } else if (kind === 'integer') {
    if (typeof value !== 'number' && typeof value !== 'string') return;
    const decimal = typeof value === 'string' ? decimalDigits(value) : value;
    // Accept signed decimal strings and digit separators, but not fractional syntax.
    if (typeof decimal === 'string' && !/^[+-]?\d(?:_?\d)*$/.test(decimal)) return;
    const number = Number(typeof decimal === 'string' ? decimal.replaceAll('_', '') : decimal);
    if (Number.isSafeInteger(number) && number > 0) return number;
  } else if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
}

/**
 * Convert Unicode decimal digits to ASCII for scalar claim validation.
 * @param value - Trimmed scalar field text.
 * @returns The same text with decimal digits normalized.
 */
function decimalDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (character) => {
    const code = character.codePointAt(0)!;
    let start = code;
    while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
    return String((code - start) % 10);
  });
}

/**
 * Normalize claims, apply defaults and validate schema and training dates.
 *
 * @param input - Untrusted claim object without a holder DID.
 * @param fields - Published field definitions.
 * @param organization - Trusted issuer name used by organization fields.
 * @returns Normalized claims including accepted additional input keys.
 * @throws IssuanceError for malformed claims, missing fields, invalid values or inconsistent dates.
 */
export function normalizeClaims(input: unknown, fields: SchemaField[], organization: string) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Object.keys(input).length ||
    Object.hasOwn(input, 'id')
  ) {
    throw new IssuanceError(
      400,
      'InvalidClaims',
      'Supply certificate attributes without a holder DID.',
      {
        missing: [],
        invalid: Object.hasOwn((input ?? {}) as object, 'id') ? ['id'] : [],
      },
    );
  }
  const claims = new Map(Object.entries(input));
  const missing = [];
  const invalid = new Set();
  for (const field of fields) {
    let value = field.organization ? organization : claims.get(field.key);
    if (typeof value === 'string') value = trimIdentityField(value);
    if (value == null || value === '') value = field.default;
    if (value == null || value === '') {
      claims.delete(field.key);
      if (field.required) missing.push(field.key);
      continue;
    }
    const normalized = normalizedValue(field.kind, value);
    if (normalized === undefined) invalid.add(field.key);
    else claims.set(field.key, normalized);
  }
  const dates = ['trainingStart', 'trainingEnd', 'issueDate'];
  const dateFields = new Set(
    fields.filter((field) => field.kind === 'date').map((field) => field.key),
  );
  if (dates.every((key) => dateFields.has(key) && claims.has(key) && !invalid.has(key))) {
    if ((claims.get('trainingEnd') as string) < (claims.get('trainingStart') as string))
      invalid.add('trainingEnd');
    if ((claims.get('issueDate') as string) < (claims.get('trainingEnd') as string))
      invalid.add('issueDate');
  }
  if (missing.length || invalid.size) {
    throw new IssuanceError(
      400,
      'InvalidClaims',
      'The certificate does not fit the certificate scheme.',
      {
        missing,
        invalid: [...invalid].sort(),
      },
    );
  }
  return Object.fromEntries(claims);
}
