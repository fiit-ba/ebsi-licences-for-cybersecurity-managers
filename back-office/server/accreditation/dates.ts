import { trimIdentityField } from '../identity/input-text.ts';

/**
 * Interpret the legacy API's ISO calendar dates and datetimes in UTC when no offset is supplied.
 * @param value - Untrusted date string, including compact dates and space-separated datetimes.
 * @returns A real calendar timestamp, or undefined for malformed/nonstring input.
 * @remarks Invalid calendar rollover is refused; JavaScript Date normalization must not silently extend authority.
 */
export function accreditationDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const input = trimIdentityField(value);
  const match =
    /^(\d{4})-?(\d{2})-?(\d{2})(?:[Tt ](\d{2})(?::?(\d{2}))?(?::?(\d{2}))?(?:[.,](\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/.exec(
      input,
    );
  if (!match) return undefined;
  const [
    ,
    year,
    month,
    day,
    hour = '00',
    minute = '00',
    second = '00',
    fraction = '',
    offset = 'Z',
  ] = match;
  if (+year < 1 || +hour > 23 || +minute > 59 || +second > 59) return undefined;
  const calendar = `${year}-${month}-${day}`;
  const date = new Date(calendar);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== calendar) return undefined;
  const zone =
    offset === 'Z' ? 'Z' : offset.slice(0, 3) + ':' + (offset.replace(':', '').slice(3) || '00');
  const result = new Date(
    `${calendar}T${hour}:${minute}:${second}.${(fraction + '000').slice(0, 3)}${zone}`,
  );
  return Number.isFinite(+result) ? result : undefined;
}
