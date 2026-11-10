import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accreditationDate } from './dates.ts';

test('accreditation calendar input retains consumed ISO forms without normalizing impossible authority dates', () => {
  for (const value of [
    '2026-11-04',
    '20261104',
    '2026-11-04 00:00:00',
    '2026-11-04T01:00:00+01:00',
  ])
    assert.equal(accreditationDate(value)?.toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(
    accreditationDate('2026-11-04T12:30:45.123456Z')?.toISOString(),
    '2026-11-04T12:30:45.123Z',
  );
  for (const value of [
    '2026-02-30',
    '2025-02-29',
    '0000-01-01',
    '2026-11-04T24:00:00Z',
    true,
    null,
    {},
    '',
  ])
    assert.equal(accreditationDate(value), undefined);
});
