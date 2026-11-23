import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ebsiSchemaIds, registrySchemaFiles } from './ebsi-schemas.ts';
import { ledgerStatusEntryRegistryId } from './publication.ts';
import { trustedSchemaRegistry } from './tsr.ts';
import {
  tsrCredentialValidation,
  validateVerificationSchema,
} from '../verification/schema-validation.ts';

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

test("a presentation may withhold a required attribute; the issuer's whole credential may not", async () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    allOf: [
      {
        properties: {
          credentialSubject: {
            type: 'object',
            properties: { id: { type: 'string' }, number: { type: 'string', minLength: 1 } },
            required: ['id', 'number'],
          },
        },
      },
    ],
  };
  const registry = trustedSchemaRegistry('https://tsr.example/v3', async () =>
    Response.json(schema),
  );
  const references = [{ id: registry.address('license') }];
  const withheld = { credentialSubject: { id: 'did:key:example' } };
  await assert.rejects(tsrCredentialValidation(registry)(withheld, references), {
    code: 'SchemaMismatch',
  });
  await tsrCredentialValidation(registry, { presented: true })(withheld, references);
  // What is disclosed must still match, and the subject's id stays required.
  await assert.rejects(
    tsrCredentialValidation(registry, { presented: true })(
      { credentialSubject: { id: 'did:key:example', number: '' } },
      references,
    ),
    { code: 'SchemaMismatch' },
  );
  await assert.rejects(
    tsrCredentialValidation(registry, { presented: true })({ credentialSubject: {} }, references),
    { code: 'SchemaMismatch' },
  );
  // Domain verification reads a presentation too.
  await validateVerificationSchema(withheld, schema, references[0].id);
  assert.deepEqual(schema.allOf[0].properties.credentialSubject.required, ['id', 'number']);
});

test("a schema extending EBSI's Verifiable Attestation is validated with it, read by id from the configured registry", async () => {
  const licence = registrySchemaFiles.cybersecurityManagerLicence;
  const base = registrySchemaFiles.ebsi[ebsiSchemaIds.attestation];
  // The licence names the base and its status entry by their pilot addresses; this registry
  // holds them under the same ids.
  const documents = new Map<string, Record<string, unknown>>([
    ['licence', licence],
    [ebsiSchemaIds.attestationHex, base],
    [ledgerStatusEntryRegistryId, registrySchemaFiles.licenceStatusEntry],
  ]);
  const requested: string[] = [];
  const registry = trustedSchemaRegistry('https://tsr.example/v1/schemas-registry', async (url) => {
    const id = String(url).split('/').pop()!;
    requested.push(id);
    return documents.has(id)
      ? Response.json(documents.get(id))
      : new Response(null, { status: 404 });
  });
  const references = [{ id: registry.address('licence') }];
  const example = JSON.parse(
    readFileSync(
      new URL('../../../schemas/cybersecurity-manager-licence/1.0.0/example.json', import.meta.url),
      'utf8',
    ),
  );
  await tsrCredentialValidation(registry)(example, references);
  assert.deepEqual(requested, [
    'licence',
    ebsiSchemaIds.attestationHex,
    ledgerStatusEntryRegistryId,
  ]);
  // The base requires `issued`.
  const { issued: _issued, ...withoutIssued } = example;
  await assert.rejects(tsrCredentialValidation(registry)(withoutIssued, references), {
    code: 'SchemaMismatch',
  });
  // The licence requires its expiry and its PlrLedgerStatusEntry, whatever else its status holds.
  const { expirationDate: _expiry, credentialStatus, ...withoutStatus } = example;
  const statusList = {
    id: 'https://status.example/1#5',
    type: 'StatusList2021Entry',
    statusListIndex: '5',
    statusListCredential: 'https://status.example/1',
  };
  for (const refused of [
    { ...withoutStatus, credentialStatus },
    withoutStatus,
    { ...example, credentialStatus: [] },
    { ...example, credentialStatus: [statusList] },
  ])
    await assert.rejects(tsrCredentialValidation(registry)(refused, references), {
      code: 'SchemaMismatch',
    });
  await tsrCredentialValidation(registry)(
    { ...example, credentialStatus: [...credentialStatus, statusList] },
    references,
  );
  // A presentation may withhold the licence's attributes, not the base's.
  const { holderName: _holder, ...subject } = example.credentialSubject;
  await tsrCredentialValidation(registry, { presented: true })(
    { ...example, credentialSubject: subject },
    references,
  );
  await assert.rejects(
    validateVerificationSchema(withoutIssued, licence, references[0].id, (url) =>
      registry.document(url),
    ),
    { message: /issued/ },
  );
  // A reference outside a schemas registry is not followed.
  documents.set('outside', { allOf: [{ $ref: 'https://elsewhere.example/base.json' }] });
  await assert.rejects(
    tsrCredentialValidation(registry)(example, [{ id: registry.address('outside') }]),
    /could not be compiled/,
  );
});
