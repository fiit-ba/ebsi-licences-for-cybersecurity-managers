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

/** Where a licence's number may come from, whether or not its schema defines it. */
const numberKeys = ['licenceNumber', 'registrationNumber'];

/**
 * Normalize claims, apply defaults and validate schema, training and examination dates.
 *
 * @param input - Untrusted claim object without a holder DID.
 * @param fields - Published field definitions.
 * @returns Normalized claims: the schema's attributes and the licence's number.
 * @throws IssuanceError for malformed claims, missing fields, invalid values, attributes the schema
 * does not define or inconsistent dates.
 */
export function normalizeClaims(input: unknown, fields: SchemaField[]) {
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
    let value = claims.get(field.key);
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
  // A licence says only what its schema defines, and its number: the registry needs one even
  // from a schema that defines none (registration.ts).
  const known = new Set([...fields.map((field) => field.key), ...numberKeys]);
  for (const key of claims.keys()) if (!known.has(key)) invalid.add(key);
  const dates = ['trainingStart', 'trainingEnd', 'issueDate'];
  const dateFields = new Set(
    fields.filter((field) => field.kind === 'date').map((field) => field.key),
  );
  const valid = (key: string) => dateFields.has(key) && claims.has(key) && !invalid.has(key);
  if (dates.every(valid)) {
    if ((claims.get('trainingEnd') as string) < (claims.get('trainingStart') as string))
      invalid.add('trainingEnd');
    if ((claims.get('issueDate') as string) < (claims.get('trainingEnd') as string))
      invalid.add('issueDate');
  }
  // The licence is granted on the examination's results, so it cannot predate the examination.
  if (
    valid('examDate') &&
    valid('issueDate') &&
    (claims.get('issueDate') as string) < (claims.get('examDate') as string)
  )
    invalid.add('examDate');
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
