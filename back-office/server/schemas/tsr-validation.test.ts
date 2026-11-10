import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trustedSchemaRegistry } from './tsr.ts';
import { tsrCredentialValidation } from '../verification/schema-validation.ts';

test('TSR validation checks both schemas and accepts only configured registry documents', async () => {
  const base = 'https://tsr.example/v3';
  const draft = 'https://json-schema.org/draft/2020-12/schema';
  const responses = new Map([
    [
      base + '/schemas/license',
      {
        $schema: draft,
        type: 'object',
        required: ['credentialSubject'],
        properties: {
          credentialSubject: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' }, hours: { type: 'integer', minimum: 1 } },
          },
        },
      },
    ],
    [
      base + '/schemas/ledger',
      {
        $schema: draft,
        required: ['credentialStatus'],
        properties: {
          credentialStatus: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['type'],
              properties: { type: { const: 'PlrLedgerStatusEntry' } },
            },
          },
        },
      },
    ],
    [base + '/schemas/external', { $ref: 'https://untrusted.example/schema' }],
  ]);
  const fetched = [];
  const registry = trustedSchemaRegistry(base, async (url, options) => {
    assert.equal(options.redirect, 'error');
    fetched.push(url);
    return responses.has(url)
      ? Response.json(responses.get(url))
      : new Response(null, { status: 404 });
  });
  const validate = tsrCredentialValidation(registry);
  const schemas = [{ id: registry.address('license') }, { id: registry.address('ledger') }];
  const credential = {
    credentialSubject: { id: 'did:key:example' },
    credentialStatus: [{ type: 'PlrLedgerStatusEntry' }],
  };
  await validate(credential, schemas);
  assert.deepEqual(
    fetched,
    schemas.map((schema) => schema.id),
  );
  await assert.rejects(
    validate(
      { ...credential, credentialSubject: { id: 'did:key:example', hours: 'three' } },
      schemas,
    ),
    { code: 'SchemaMismatch', outcome: 'INDETERMINATE' },
  );
  await assert.rejects(validate({ ...credential, credentialStatus: [] }, schemas), {
    code: 'SchemaMismatch',
  });
  await assert.rejects(
    validate(credential, [{ id: 'https://untrusted.example/schema' }]),
    /outside the configured TSR/,
  );
  await assert.rejects(
    validate(credential, [{ id: registry.address('external') }]),
    /could not be compiled/,
  );
  assert.ok(fetched.every((url) => url.startsWith(base)));
});
