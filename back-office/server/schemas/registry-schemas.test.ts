import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import {
  RegistrySchemaError,
  configuredSchemaIds,
  registrySchema,
  registrySchemas,
} from './registry-schemas.ts';
import { certificateSchemaDocument } from './fixtures/certificate-schema.ts';
import { postgresSchemaCatalog } from './catalog.ts';
import { trustedSchemaRegistry } from './tsr.ts';
import { developmentSchemaDocument } from '../../scripts/development-schema.ts';
import type { SchemaField } from './types.ts';

const fields: SchemaField[] = [
  {
    key: 'holderName',
    kind: 'text',
    label: { sk: 'Meno držiteľa', en: 'Meno držiteľa' },
    hint: { sk: 'napr. Ing. Janko Mrkvička', en: 'napr. Ing. Janko Mrkvička' },
    required: true,
    default: '',
  },
  {
    key: 'trainingDays',
    kind: 'integer',
    label: { sk: 'Počet dní', en: 'Počet dní' },
    hint: { sk: '', en: '' },
    required: true,
    default: '3',
  },
  {
    key: 'issueDate',
    kind: 'date',
    label: { sk: 'Dátum vydania', en: 'Dátum vydania' },
    hint: { sk: '', en: '' },
    required: false,
    default: '',
  },
];

test('a registry schema gives the issuance form its type, title and attributes', () => {
  const schema = registrySchema(
    'zTest',
    certificateSchemaDocument('TestCertificate', 'Test', fields),
  );
  assert.deepEqual(schema, {
    id: 'zTest',
    credential_type: 'TestCertificate',
    name: 'Test',
    fields,
  });

  // The development schema reads back with every attribute it had.
  const development = registrySchema('zDev', developmentSchemaDocument);
  assert.equal(development.credential_type, 'CybersecurityManagerCertificate');
  assert.equal(development.fields.length, 15);
  assert.deepEqual(
    development.fields.filter((field) => !field.required).map((field) => field.key),
    ['jobPosition', 'funding'],
  );
  assert.deepEqual(
    development.fields.find((field) => field.key === 'trainingDays')?.kind,
    'integer',
  );

  // A key without a title is labelled with the key; `format: date` is a date too; allOf parts count.
  const plain = registrySchema('zPlain', {
    allOf: [
      { $ref: 'https://api-pilot.ebsi.eu/trusted-schemas-registry/v3/schemas/zAttestation' },
      {
        properties: {
          type: { contains: { const: 'PlainCertificate' } },
          credentialSubject: {
            properties: { id: {}, valid: { type: 'string', format: 'date' } },
            required: ['valid'],
          },
        },
      },
    ],
  });
  assert.equal(plain.name, 'PlainCertificate');
  assert.deepEqual(plain.fields, [
    {
      key: 'valid',
      kind: 'date',
      label: { sk: 'valid', en: 'valid' },
      hint: { sk: '', en: '' },
      required: true,
      default: '',
    },
  ]);

  for (const document of [
    { properties: { credentialSubject: { properties: { a: { type: 'string' } } } } },
    {
      properties: {
        type: { contains: { const: 'VerifiableAttestation' } },
        credentialSubject: { properties: { a: { type: 'string' } } },
      },
    },
    {
      properties: {
        type: { contains: { const: 'ObjectCertificate' } },
        credentialSubject: { properties: { address: { type: 'object' } } },
      },
    },
    { properties: { type: { contains: { const: 'EmptyCertificate' } } } },
  ])
    assert.throws(() => registrySchema('zBad', document), RegistrySchemaError);

  assert.deepEqual(configuredSchemaIds(' zA, zB\nzA '), ['zA', 'zB']);
  assert.throws(() => configuredSchemaIds('zA,../x'));
});

test('the configured registry schemas become versions, and a type no id names any more is retired', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const type = 'RegistrySynchronizationTestCertificate';
  const documents = new Map<string, Record<string, unknown>>([
    ['zSyncV1', certificateSchemaDocument(type, 'Synchronizácia', fields)],
  ]);
  const registry = trustedSchemaRegistry('https://tsr.example/v1/schemas-registry', async (url) => {
    const document = documents.get(decodeURIComponent(String(url).split('/').pop()!));
    return document ? Response.json(document) : new Response(null, { status: 404 });
  });
  // The run shares its database with other checks: put back any schema of theirs this retires.
  const retiredByUs = new Set<string>();
  context.after(async () => {
    try {
      await database.query(
        'UPDATE certificate_schemas SET retired_at = NULL WHERE credential_type = ANY($1::text[])',
        [[...retiredByUs].filter((retired) => retired !== type)],
      );
      await database.query(
        'DELETE FROM certificate_schema_versions WHERE schema_id IN (SELECT id FROM certificate_schemas WHERE credential_type = $1)',
        [type],
      );
      await database.query('DELETE FROM certificate_schemas WHERE credential_type = $1', [type]);
    } finally {
      await database.end();
    }
  });
  const registered: string[] = [];
  const sync = async (ids: string[]) => {
    const result = await registrySchemas(database, registry, {
      ids,
      registered: async (credentialType) => void registered.push(credentialType),
    }).synchronize();
    for (const retired of result.retired) retiredByUs.add(retired);
    return result;
  };
  const versions = async () =>
    (
      await database.query(
        `SELECT v.version, v.tsr_id, v.fields, s.name_sk, s.name_en, s.retired_at FROM certificate_schema_versions v
        JOIN certificate_schemas s ON s.id = v.schema_id WHERE s.credential_type = $1 ORDER BY v.version`,
        [type],
      )
    ).rows;

  assert.deepEqual((await sync(['zSyncV1'])).added, [type]);
  assert.deepEqual(registered, [type]);
  let stored = await versions();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].tsr_id, 'zSyncV1');
  assert.deepEqual(stored[0].fields, fields);
  assert.equal(stored[0].name_sk, 'Synchronizácia');
  assert.equal(stored[0].name_en, 'Synchronizácia');

  // The registry's current revision replaces the attributes of a known id: no new version.
  documents.set('zSyncV1', certificateSchemaDocument(type, 'Synchronizácia', fields.slice(0, 2)));
  assert.deepEqual((await sync(['zSyncV1'])).added, []);
  stored = await versions();
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].fields, fields.slice(0, 2));

  // A new id of the same type is its next version.
  documents.set('zSyncV2', certificateSchemaDocument(type, 'Synchronizácia 2', fields));
  assert.deepEqual((await sync(['zSyncV1', 'zSyncV2'])).added, [type]);
  stored = await versions();
  assert.deepEqual(
    stored.map((version) => [version.version, version.tsr_id]),
    [
      [1, 'zSyncV1'],
      [2, 'zSyncV2'],
    ],
  );
  const catalog = await postgresSchemaCatalog(database).names();
  assert.equal(
    catalog.find((schema) => schema.credential_type === type)?.name.sk,
    'Synchronizácia 2',
  );

  // An id the registry does not hold changes nothing.
  await assert.rejects(sync(['zSyncV1', 'zSyncV2', 'zMissing']));
  assert.equal((await versions()).length, 2);

  // No id of the type configured: retired, and back once one is.
  assert.ok((await sync([])).retired.includes(type));
  assert.ok((await versions())[0].retired_at);
  await sync(['zSyncV2']);
  assert.equal((await versions())[0].retired_at, null);
});
