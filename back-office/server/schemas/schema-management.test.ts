import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { SchemaError } from './definition.ts';
import { postgresSchemaManagement } from './management.ts';
import { postgresSchemaCatalog } from './catalog.ts';
import { trustedSchemaRegistry } from './tsr.ts';

test('schema versions follow draft, TSR confirmation and retirement rules', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const type = 'SchemaManagementTest';
  const {
    rows: [account],
  } = await database.query(`
    INSERT INTO operator_accounts (username, password_hash)
    VALUES ('schema-test-root', 'no-password') RETURNING id
  `);
  context.after(async () => {
    try {
      await database.query('DELETE FROM schema_events WHERE credential_type = $1', [type]);
      await database.query(
        `
        DELETE FROM certificate_schema_versions
        WHERE schema_id IN (SELECT id FROM certificate_schemas WHERE credential_type = $1)
      `,
        [type],
      );
      await database.query('DELETE FROM certificate_schemas WHERE credential_type = $1', [type]);
      await database.query('DELETE FROM accredited_organizations WHERE account_id = $1', [
        account.id,
      ]);
      await database.query('DELETE FROM operator_accounts WHERE id = $1', [account.id]);
    } finally {
      await database.end();
    }
  });
  const registry = trustedSchemaRegistry('https://tsr.example/v3', async (url) =>
    url.endsWith('/published')
      ? Response.json({ type: 'object' })
      : new Response(null, { status: 404 }),
  );
  const schemas = postgresSchemaManagement(database, registry);
  const field = { key: 'number', kind: 'integer', label: { sk: 'Číslo' } };
  const input = { credential_type: type, name_sk: 'Licencia', fields: [field] };
  await assert.rejects(
    schemas.propose(account.id, input),
    (error) => error instanceof SchemaError && error.body.reason === 'NotRootTao',
  );
  await database.query(
    "INSERT INTO accredited_organizations (name, kind, account_id) VALUES ('Root', 'rtao', $1)",
    [account.id],
  );
  await database.query("INSERT INTO operator_roles VALUES ($1, 'plr_rtao')", [account.id]);

  const initial = await schemas.propose(account.id, input);
  assert.equal(initial.pending_version, 1);
  const edited = { ...input, fields: [{ ...field, label: { sk: 'Evidenčné číslo' } }] };
  const draft = await schemas.propose(account.id, edited);
  assert.equal(draft.versions.length, 1);
  assert.equal(draft.versions[0].fields[0].label.sk, 'Evidenčné číslo');
  await assert.rejects(
    schemas.confirm(account.id, { credential_type: type, version: 1, tsr_id: 'missing' }),
    (error) => error instanceof SchemaError && error.body.reason === 'NotInTsr',
  );
  const published = await schemas.confirm(account.id, {
    credential_type: type,
    version: 1,
    tsr_id: 'published',
  });
  assert.equal(published.current_version, 1);
  assert.equal(published.pending_version, null);
  assert.equal(published.versions[0].schema_address, 'https://tsr.example/v3/schemas/published');
  await assert.rejects(
    schemas.propose(account.id, { ...input, fields: [{ ...field, kind: 'date' }] }),
    (error) =>
      error instanceof SchemaError &&
      Array.isArray(error.body.errors) &&
      error.body.errors.some((item) => item.code === 'KindChanged'),
  );
  assert.equal(
    (await schemas.propose(account.id, { ...edited, name_sk: 'Nový názov' })).versions.length,
    1,
  );
  await context.test(
    'failed automatic publication retains a retryable draft and concurrent editors publish distinct versions',
    async () => {
      const failing = postgresSchemaManagement(database, registry, {
        publish: async () => {
          throw new Error('TSR outage');
        },
      });
      await assert.rejects(
        failing.propose(account.id, input),
        (error) =>
          error instanceof SchemaError &&
          error.status === 502 &&
          error.body.reason === 'RegistrationFailed',
      );
      let release: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const documents: { version: number; label: string }[] = [];
      const publishing = postgresSchemaManagement(database, registry, {
        publish: async (schema) => {
          const draft = schema.versions.find((item) => item.version === schema.pending_version)!;
          documents.push({ version: draft.version, label: draft.fields[0].label.sk });
          if (documents.length === 1) {
            entered();
            await gate;
          }
          return 'published';
        },
      });
      const first = publishing.propose(account.id, input);
      await started;
      const second = publishing.propose(account.id, edited);
      release();
      const results = await Promise.all([first, second]);
      assert.deepEqual(
        results.map((item) => item.current_version),
        [2, 3],
      );
      assert.deepEqual(documents, [
        { version: 2, label: 'Číslo' },
        { version: 3, label: 'Evidenčné číslo' },
      ]);
    },
  );
  assert.equal((await schemas.propose(account.id, input)).pending_version, 4);
  const retired = await schemas.retire(account.id, input);
  assert.ok(retired.retired_at);
  await assert.rejects(
    schemas.propose(account.id, input),
    (error) => error instanceof SchemaError && error.body.reason === 'SchemaRetired',
  );
  const names = await postgresSchemaCatalog(database).names();
  assert.equal(
    names.find((schema) => schema.credential_type === type).labels.number.sk,
    'Evidenčné číslo',
  );
});
