import { trimIdentityField } from '../identity/input-text.ts';

/**
 * Interpret truth-value coercion for JSON schema editor fields.
 * @param value - JSON field.
 * @returns False for null, false, zero, empty strings and empty containers.
 */
export function schemaFlag(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Normalize a primitive schema editor field with Unicode code-point bounds.
 * @param value - JSON field; numbers and booleans are converted to text.
 * @param limit - Maximum stored Unicode characters.
 * @returns Trimmed text with Unicode whitespace, including control and nonbreaking space characters.
 */
export function schemaText(value: unknown, limit: number): string {
  const text =
    value == null ? '' : typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
  return Array.from(trimIdentityField(text)).slice(0, limit).join('');
}

/**
 * Normalize calendar, compact or ISO-week date defaults.
 * @param value - Supplied date default.
 * @returns An exact YYYY-MM-DD date, or undefined when it is not a real ISO calendar date.
 */
export function schemaDate(value: string): string | undefined {
  let calendar = value;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) calendar = `${compact[1]}-${compact[2]}-${compact[3]}`;
  const week = /^(\d{4})-?W(\d{2})(?:-?([1-7]))?$/.exec(value);
  if (week && +week[1] > 0 && +week[2] >= 1 && +week[2] <= 53) {
    const january = new Date(`${week[1]}-01-04T00:00:00Z`);
    january.setUTCDate(
      4 - ((january.getUTCDay() + 6) % 7) + (+week[2] - 1) * 7 + (+(week[3] ?? 1) - 1),
    );
    const thursday = new Date(+january);
    thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
    if (thursday.getUTCFullYear() !== +week[1]) return undefined;
    calendar = january.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendar) || calendar.startsWith('0000')) return undefined;
  const date = new Date(calendar);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === calendar
    ? calendar
    : undefined;
}

/**
 * Check positive decimal defaults using Unicode decimal digits.
 * @param value - Normalized default text.
 * @returns Whether all characters are decimal digits and at least one represents a nonzero value.
 */
export function positiveSchemaInteger(value: string): boolean {
  if (!/^\p{Nd}+$/u.test(value)) return false;
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    let start = code;
    while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
    return (code - start) % 10 !== 0;
  });
}
