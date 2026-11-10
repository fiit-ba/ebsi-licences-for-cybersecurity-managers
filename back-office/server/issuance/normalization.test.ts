import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { normalizeClaims, IssuanceError } from './claims.ts';
import { issuanceInput, IssuanceInputError } from './input.ts';
import { claimCompatibilityCases, issuanceInputCases } from './fixtures/compatibility-cases.ts';
import type { SchemaField } from '../schemas/types.ts';

test('Unicode claim/date/integer normalization and complete request refusals retain the accepted contract', async () => {
  const expected = JSON.parse(
    await readFile(new URL('./fixtures/normalization.json', import.meta.url), 'utf8'),
  );
  const claims = claimCompatibilityCases.map((item) => {
    try {
      return {
        claims: normalizeClaims(
          { value: item.value },
          [{ key: 'value', kind: item.kind, required: true, default: '' } as SchemaField],
          'Fixture TI',
        ),
      };
    } catch (error) {
      if (error instanceof IssuanceError)
        return { missing: error.body.missing, invalid: error.body.invalid };
      throw error;
    }
  });
  const inputs = issuanceInputCases.map((item) => {
    try {
      const value = issuanceInput(item);
      return {
        ...value,
        valid_from: value.valid_from?.toISOString().replace('.000Z', '+00:00') ?? null,
        valid_until: value.valid_until?.toISOString().replace('.000Z', '+00:00') ?? null,
      };
    } catch (error) {
      if (error instanceof IssuanceInputError) return { errors: error.body };
      throw error;
    }
  });
  assert.deepEqual(claims, expected.claims);
  assert.deepEqual(inputs, expected.inputs);
});
