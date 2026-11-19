import type { Pool, PoolClient } from 'pg';
import type { trustedSchemaRegistry } from './tsr.ts';
import type { SchemaField } from './types.ts';
import { appendAudit } from '../audit/journal.ts';
import { transaction } from '../adapters/transaction.ts';

/** Types the trust chain and the W3C data model use themselves; never a certificate's. */
const reservedTypes = new Set([
  'VerifiableCredential',
  'VerifiableAttestation',
  'VerifiablePresentation',
  'VerifiableAccreditation',
  'VerifiableAccreditationToAttest',
  'VerifiableAccreditationToAccredit',
  'VerifiableAuthorisationToOnboard',
  'VerifiableAuthorisationForTrustChain',
  'StatusList2021Credential',
  'BitstringStatusListCredential',
]);
const datePattern = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

/** A certificate schema as the Trusted Schemas Registry holds it. */
export interface RegistrySchema {
  /** Its id in the registry. */
  id: string;
  credential_type: string;
  /** The schema's `title`. */
  name: string;
  fields: SchemaField[];
}

/** A registry schema the issuance form cannot use. */
export class RegistrySchemaError extends Error {}

/**
 * Narrow an unknown JSON value to an object.
 * @param value - Parsed JSON value.
 * @returns Whether it is a non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Trimmed, bounded text of an annotation.
 * @param value - Annotation value.
 * @param max - Maximum length.
 * @returns The text, or empty.
 */
function annotation(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Read a certificate schema from its registry document.
 *
 * The credential type is the one `properties.type` must contain (`contains.const`). Each property
 * of `credentialSubject` but `id` is an attribute: `type: integer` a number, a `string` with
 * `format: date` or the ISO date pattern a date, any other `string` text. `title` is the label,
 * `description` the hint, `default` the value the form starts with, and `credentialSubject.required`
 * says which are required. Properties of `allOf` parts count as the document's own.
 * @param id - The schema's registry id.
 * @param document - Its JSON Schema.
 * @returns The schema.
 * @throws RegistrySchemaError for a document without a credential type, with an attribute the
 * form cannot fill, or with no attributes.
 */
export function registrySchema(id: string, document: Record<string, unknown>): RegistrySchema {
  const parts = [document, ...(Array.isArray(document.allOf) ? document.allOf : [])].filter(
    isObject,
  );
  const property = (name: string) =>
    parts
      .map((part) => (isObject(part.properties) ? part.properties[name] : undefined))
      .find(isObject);
  const type = property('type');
  const credentialType =
    isObject(type?.contains) && typeof type.contains.const === 'string' ? type.contains.const : '';
  if (!/^[A-Za-z][A-Za-z0-9]{0,100}$/.test(credentialType) || reservedTypes.has(credentialType))
    throw new RegistrySchemaError(
      `The schema ${id} names no certificate type in properties.type.contains.const.`,
    );
  const subject = property('credentialSubject');
  const required = new Set(Array.isArray(subject?.required) ? subject.required : []);
  const fields: SchemaField[] = [];
  for (const [key, value] of Object.entries(
    isObject(subject?.properties) ? subject.properties : {},
  )) {
    if (key === 'id') continue;
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || key === 'type' || !isObject(value))
      throw new RegistrySchemaError(
        `The schema ${id} has an attribute the form cannot fill: ${key}.`,
      );
    const kind =
      value.type === 'integer'
        ? 'integer'
        : value.type === 'string'
          ? value.format === 'date' || value.pattern === datePattern
            ? 'date'
            : 'text'
          : '';
    if (!kind)
      throw new RegistrySchemaError(
        `The schema ${id} gives ${key} a type the form cannot fill: ${JSON.stringify(value.type)}.`,
      );
    const label = annotation(value.title, 120) || key;
    const hint = annotation(value.description, 200);
    fields.push({
      key,
      kind,
      label: { sk: label, en: label },
      hint: { sk: hint, en: hint },
      required: required.has(key),
      default:
        typeof value.default === 'string' || typeof value.default === 'number'
          ? String(value.default).slice(0, 500)
          : '',
    });
  }
  if (!fields.length || fields.length > 40)
    throw new RegistrySchemaError(`The schema ${id} has ${fields.length} attributes, not 1 to 40.`);
  return {
    id,
    credential_type: credentialType,
    name: annotation(document.title, 200) || credentialType,
    fields,
  };
}

/** A stored schema with its versions, one per registry id. */
interface SchemaOverviewRow {
  credential_type: string;
  name_sk: string;
  name_en: string;
  created_at: Date;
  retired_at: Date | null;
  organizations: number;
  versions: { version: number; fields: SchemaField[]; tsr_id: string; registered_at: Date }[];
}

/**
 * The certificate schemas this installation takes from EBSI's Trusted Schemas Registry.
 *
 * Nobody defines a schema here: on EBSI the Support Office registers them. The installation
 * names the registry ids it uses (`PLR_TSR_SCHEMAS`); each is a version of the certificate type
 * it names, later ids newer. A type none of whose ids is named any more is retired: no new
 * certificates of it, while those already issued keep their schema.
 * @param database - PostgreSQL pool.
 * @param registry - The configured Trusted Schemas Registry.
 * @param options - The registry ids, in order, and what to do when a version is added.
 * @returns The overview and the synchronization.
 */
export function registrySchemas(
  database: Pool,
  registry: ReturnType<typeof trustedSchemaRegistry>,
  options: {
    ids: string[];
    /** A version was added: TI accreditations may cover it now. */
    registered?: (credentialType: string) => Promise<void>;
  },
) {
  /**
   * Read the stored schemas with their versions.
   * @param client - Query executor.
   * @returns The schemas, newest version first.
   * @throws Database errors.
   */
  async function overview(client: Pick<PoolClient, 'query'>) {
    const { rows } = await client.query<SchemaOverviewRow>(`
      SELECT s.credential_type, s.name_sk, s.name_en, s.created_at, s.retired_at,
        (SELECT count(*)::integer FROM organization_certificate_schemas g WHERE g.schema_id = s.id) AS organizations,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'version', v.version, 'fields', v.fields, 'tsr_id', v.tsr_id, 'registered_at', v.registered_at
          ) ORDER BY v.version DESC)
          FROM certificate_schema_versions v
          WHERE v.schema_id = s.id AND v.registered_at IS NOT NULL
        ), '[]'::jsonb) AS versions
      FROM certificate_schemas s
      ORDER BY s.name_sk, s.credential_type
    `);
    return rows.map(({ name_sk, name_en, versions, ...schema }) => ({
      ...schema,
      name: { sk: name_sk, en: name_en },
      current_version: versions[0]?.version ?? null,
      versions: versions.map((version) => ({
        ...version,
        schema_address: registry.address(version.tsr_id),
      })),
    }));
  }

  return {
    ids: options.ids,

    /**
     * The schemas for the console's Schémy tab, read-only.
     * @returns The registry ids in use and the stored schemas.
     * @throws Database errors.
     */
    async list() {
      return { registry_ids: options.ids, schemas: await overview(database) };
    },

    /**
     * Read every configured schema from the registry and store it: a new id becomes the type's
     * next version, a known one takes the registry's current attributes, and a type none of whose
     * ids is configured is retired. All or nothing: a schema that cannot be read or used leaves
     * everything as it was.
     * @returns The types that gained a version and those retired.
     * @throws Registry, RegistrySchemaError or database errors.
     */
    async synchronize() {
      const schemas: RegistrySchema[] = [];
      for (const id of options.ids)
        schemas.push(registrySchema(id, await registry.document(registry.address(id))));
      const added: string[] = [];
      const retired: string[] = [];
      await transaction(database, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(651907,0)');
        for (const schema of schemas) {
          const {
            rows: [stored],
          } = await client.query(
            `INSERT INTO certificate_schemas (credential_type, name_sk, name_en) VALUES ($1, $2, $2)
            ON CONFLICT (credential_type) DO UPDATE SET name_sk = EXCLUDED.name_sk,
              name_en = EXCLUDED.name_en, retired_at = NULL, retired_by = NULL
            RETURNING id`,
            [schema.credential_type, schema.name],
          );
          const fields = JSON.stringify(schema.fields);
          const known = await client.query(
            'UPDATE certificate_schema_versions SET fields = $3::jsonb WHERE schema_id = $1 AND tsr_id = $2',
            [stored.id, schema.id, fields],
          );
          if (known.rowCount) continue;
          const {
            rows: [version],
          } = await client.query(
            `INSERT INTO certificate_schema_versions (schema_id, version, fields, tsr_id, registered_at)
            SELECT $1, COALESCE(max(version), 0) + 1, $3::jsonb, $2, statement_timestamp()
            FROM certificate_schema_versions WHERE schema_id = $1
            RETURNING version`,
            [stored.id, schema.id, fields],
          );
          await appendAudit(client, {
            event: 'schema.registered',
            detail: { credential_type: schema.credential_type, version: version.version },
          });
          added.push(schema.credential_type);
        }
        const { rows } = await client.query(
          `UPDATE certificate_schemas s SET retired_at = statement_timestamp()
          WHERE s.retired_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM certificate_schema_versions v WHERE v.schema_id = s.id AND v.tsr_id = ANY($1::text[])
          ) RETURNING s.credential_type`,
          [options.ids],
        );
        for (const row of rows) {
          await appendAudit(client, {
            event: 'schema.retired',
            detail: { credential_type: row.credential_type, version: null },
          });
          retired.push(row.credential_type);
        }
      });
      for (const type of new Set(added)) await options.registered?.(type);
      return { added: [...new Set(added)], retired };
    },
  };
}

/**
 * Parse `PLR_TSR_SCHEMAS`: registry ids separated by commas or white space, oldest first.
 * @param value - The variable's value.
 * @returns The ids.
 * @throws Error for an id the registry could not hold.
 */
export function configuredSchemaIds(value: string | undefined) {
  const ids = (value ?? '').split(/[\s,]+/).filter(Boolean);
  for (const id of ids)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(id) || id === '.' || id === '..')
      throw new Error(`PLR_TSR_SCHEMAS names an invalid registry id: ${id}`);
  return [...new Set(ids)];
}
