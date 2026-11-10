import type { Pool, PoolClient } from 'pg';
import type { OperatorAccount } from '../identity/auth/accounts.ts';
import type { trustedSchemaRegistry } from './tsr.ts';
import type { SchemaField } from './types.ts';

/** Stored schema overview with its registered and draft version projections. */
interface SchemaOverviewRow {
  credential_type: string;
  name_sk: string;
  name_en: string;
  created_at: Date;
  retired_at: Date | null;
  organizations: number;
  versions: {
    version: number;
    fields: SchemaField[];
    tsr_id: string;
    proposed_by: string;
    proposed_at: Date;
    registered_at: Date | null;
  }[];
}
import { isDeepStrictEqual } from 'node:util';
import { appendAudit } from '../audit/journal.ts';
import { transaction } from '../adapters/transaction.ts';
import { SchemaError, validateDefinition } from './definition.ts';
import { schemaText as text } from './input.ts';
import type { SchemaPublication } from './publication.ts';

/** Existing external publication and accreditation side effects composed by the runtime. */
export interface SchemaManagementOptions {
  publish?: (schema: SchemaPublication, database: Pick<PoolClient, 'query'>) => Promise<string>;
  registered?: (credentialType: string) => Promise<void>;
  reportIntegrationError?: (operation: string) => void;
}

/**
 * Determine whether a loaded profile advertises RootTAO schema management.
 *
 * @param account - Authenticated account with organization kind and roles.
 * @returns Whether the profile has the RootTAO organization and role.
 * @remarks Mutations independently recheck current authority inside their transaction.
 */
export const canManageSchemas = (account: Pick<OperatorAccount, 'organization_kind' | 'roles'>) =>
  account.organization_kind === 'rtao' && account.roles.includes('plr_rtao');

/**
 * Lock and validate the current active RootTAO authority.
 *
 * @param client - Transaction connection.
 * @param id - Operator account ID.
 * @returns Completion when schema management is authorized.
 * @throws SchemaError for missing RootTAO authority; database errors.
 */
async function authorize(client: PoolClient, id: number) {
  const { rowCount } = await client.query(
    `
    SELECT a.id FROM operator_accounts a
    JOIN accredited_organizations o ON o.account_id = a.id
    JOIN operator_roles r ON r.account_id = a.id AND r.role = 'plr_rtao'
    WHERE a.id = $1 AND a.active AND o.kind = 'rtao'
      AND (o.revoked_at IS NULL OR o.revoked_at > statement_timestamp())
    FOR SHARE OF a, o, r
  `,
    [id],
  );
  if (!rowCount)
    throw new SchemaError(403, 'NotRootTao', 'Only the RootTAO defines certificate schemas.');
}

/**
 * Lock an existing nonretired schema.
 *
 * @param client - Transaction connection.
 * @param type - Credential-type name.
 * @returns The locked schema row.
 * @throws SchemaError if unknown or retired; database errors.
 */
async function lockSchema(client: PoolClient, type: string) {
  const {
    rows: [schema],
  } = await client.query(
    'SELECT * FROM certificate_schemas WHERE credential_type = $1 FOR UPDATE',
    [type],
  );
  if (!schema) throw new SchemaError(404, 'UnknownSchema', 'Unknown certificate schema.');
  if (schema.retired_at) throw new SchemaError(409, 'SchemaRetired', 'The schema is retired.');
  return schema;
}

/**
 * Record a schema change and corresponding audit event.
 *
 * @param client - Transaction connection.
 * @param action - Schema event name.
 * @param type - Credential-type name.
 * @param version - Affected version.
 * @param actor - Acting operator ID.
 * @returns Completion of both event inserts.
 * @throws Database errors if a query, lock or commit fails.
 */
async function record(
  client: PoolClient,
  action: string,
  type: string,
  version: number | null,
  actor: number,
) {
  await client.query(
    'INSERT INTO schema_events (action, credential_type, version, actor_id) VALUES ($1, $2, $3, $4)',
    [action, type, version, actor],
  );
  await appendAudit(client, {
    event: action.replace('schema_', 'schema.'),
    actor,
    detail: { credential_type: type, version },
  });
}

/**
 * Create versioned schema draft, confirmation and retirement operations.
 *
 * @param database - PostgreSQL pool.
 * @param registry - Trusted registry address and existence adapter.
 * @param options - Optional development publication and post-registration accreditation refresh.
 * @returns Staff overview and RootTAO mutation operations.
 */
export function postgresSchemaManagement(
  database: Pool,
  registry: ReturnType<typeof trustedSchemaRegistry>,
  options: SchemaManagementOptions = {},
) {
  /**
   * Load schema versions and resolve their trusted registry addresses.
   *
   * @param client - Query executor.
   * @param type - Optional credential-type filter.
   * @returns Schemas with current/pending version metadata and field definitions.
   * @throws Database errors if a query, lock or commit fails.
   */
  async function overview(client: Pick<PoolClient, 'query'>, type: string | null = null) {
    const { rows } = await client.query<SchemaOverviewRow>(
      `
      SELECT s.credential_type, s.name_sk, s.name_en, s.created_at, s.retired_at,
        (SELECT count(*)::integer FROM organization_certificate_schemas g WHERE g.schema_id = s.id) AS organizations,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'version', v.version, 'fields', v.fields, 'tsr_id', COALESCE(v.tsr_id, ''),
            'proposed_by', a.username, 'proposed_at', v.proposed_at, 'registered_at', v.registered_at
          ) ORDER BY v.version DESC)
          FROM certificate_schema_versions v
          LEFT JOIN operator_accounts a ON a.id = v.proposed_by
          WHERE v.schema_id = s.id
        ), '[]'::jsonb) AS versions
      FROM certificate_schemas s
      WHERE ($1::text IS NULL OR s.credential_type = $1)
      ORDER BY s.name_sk, s.credential_type
    `,
      [type],
    );
    return rows.map(({ name_sk, name_en, versions, ...schema }) => ({
      ...schema,
      name: { sk: name_sk, en: name_en },
      current_version: versions.find((version) => version.registered_at)?.version ?? null,
      pending_version: versions.find((version) => !version.registered_at)?.version ?? null,
      versions: versions.map((version) => ({
        ...version,
        schema_address: version.tsr_id ? registry.address(version.tsr_id) : '',
      })),
    }));
  }

  const management = {
    /**
     * Return the staff schema overview and current management capability.
     *
     * @param account - Authenticated account.
     * @returns Management and automatic-publication flags with the schema versions.
     * @throws Database errors if a query, lock or commit fails.
     */
    async list(account: OperatorAccount) {
      return {
        can_manage: canManageSchemas(account),
        registers_in_mock: Boolean(options.publish),
        schemas: await overview(database),
      };
    },

    /**
     * Create or replace a draft while retaining published field-kind compatibility.
     *
     * @param actor - RootTAO operator account ID.
     * @param input - Credential type, display names and field definitions.
     * @returns The updated schema overview.
     * @throws SchemaError for invalid definitions, retired schemas or lost authority; database
     * errors.
     */
    async propose(actor: number, input: Record<string, unknown>) {
      const type = text(input.credential_type, 101);
      const nameSk = text(input.name_sk, 200);
      const nameEn = text(input.name_en, 200);
      let publicationFailed = false;
      let registered = false;
      const result = await transaction(database, async (client) => {
        await authorize(client, actor);
        if (options.publish) await client.query('SELECT pg_advisory_xact_lock(651907,0)');
        await client.query('SELECT pg_advisory_xact_lock(651901, hashtext($1))', [type]);
        const {
          rows: [existing],
        } = await client.query(
          'SELECT * FROM certificate_schemas WHERE credential_type = $1 FOR UPDATE',
          [type],
        );
        if (existing?.retired_at)
          throw new SchemaError(409, 'SchemaRetired', 'The schema is retired.');
        const { rows: versions } = await client.query(
          `
          SELECT version, fields, registered_at FROM certificate_schema_versions
          WHERE schema_id = $1 ORDER BY version DESC
        `,
          [existing?.id ?? null],
        );
        const published = versions.filter((version) => version.registered_at);
        const fields = validateDefinition(
          type,
          nameSk || existing?.name_sk,
          input.fields,
          published,
        );
        const {
          rows: [schema],
        } = await client.query(
          `
          INSERT INTO certificate_schemas (credential_type, name_sk, name_en)
          VALUES ($1, $2, $3)
          ON CONFLICT (credential_type) DO UPDATE SET name_sk = EXCLUDED.name_sk, name_en = EXCLUDED.name_en
          RETURNING id
        `,
          [type, nameSk || existing.name_sk, nameEn],
        );
        const draft = versions.find((version) => !version.registered_at);
        if (draft || !isDeepStrictEqual(published[0]?.fields, fields)) {
          const version = draft?.version ?? (versions[0]?.version ?? 0) + 1;
          await client.query(
            `
            INSERT INTO certificate_schema_versions (schema_id, version, fields, proposed_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (schema_id, version) DO UPDATE SET fields = EXCLUDED.fields,
              proposed_by = EXCLUDED.proposed_by, proposed_at = statement_timestamp()
          `,
            [schema.id, version, JSON.stringify(fields), actor],
          );
          await record(client, 'schema_proposed', type, version, actor);
        } else if (
          existing.name_sk !== (nameSk || existing.name_sk) ||
          existing.name_en !== nameEn
        ) {
          await record(client, 'schema_renamed', type, published[0].version, actor);
        }
        let current = (await overview(client, type))[0];
        if (options.publish && current.pending_version) {
          let id: string;
          try {
            id = await options.publish(current, client);
            if (!(await registry.contains(id)))
              throw new Error('The published version is unavailable.');
          } catch {
            publicationFailed = true;
            return current;
          }
          // Keep the schema lock through publication and confirmation. Otherwise
          // two editors can overwrite the same deterministic TSR version ID.
          await client.query(
            `UPDATE certificate_schema_versions SET tsr_id=$3,registered_at=statement_timestamp()
            WHERE schema_id=$1 AND version=$2`,
            [schema.id, current.pending_version, id],
          );
          await record(client, 'schema_registered', type, current.pending_version, actor);
          registered = true;
          current = (await overview(client, type))[0];
        }
        return current;
      });
      if (publicationFailed)
        throw new SchemaError(
          502,
          'RegistrationFailed',
          'The version remains a draft because registration failed.',
        );
      if (registered) {
        try {
          await options.registered?.(type);
        } catch {
          options.reportIntegrationError?.('published schema accreditation refresh');
        }
      }
      return result;
    },

    /**
     * Confirm a registered TSR identifier only if the inspected draft is unchanged.
     *
     * @param actor - RootTAO operator account ID.
     * @param input - Credential type, draft version and TSR ID.
     * @param expectedFields - Internal publication snapshot; omit for manual confirmation.
     * @returns The updated schema with its registered version.
     * @throws SchemaError for invalid identifiers, missing TSR record, changed draft or lost
     * authority; database errors.
     */
    async confirm(actor: number, input: Record<string, unknown>, expectedFields?: SchemaField[]) {
      const type = text(input.credential_type, 101);
      const version = Number(input.version);
      const id = typeof input.tsr_id === 'string' ? input.tsr_id.trim() : '';
      if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647) {
        throw new SchemaError(400, 'InvalidFields', 'Version is a positive integer.', {
          fields: ['version'],
        });
      }
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(id) || id === '.' || id === '..') {
        throw new SchemaError(400, 'TsrIdInvalid', 'Invalid TSR identifier.');
      }

      const {
        rows: [draft],
      } = await database.query(
        `
        SELECT v.fields, v.registered_at, s.retired_at FROM certificate_schema_versions v
        JOIN certificate_schemas s ON s.id = v.schema_id
        WHERE s.credential_type = $1 AND v.version = $2
      `,
        [type, version],
      );
      if (!draft)
        throw new SchemaError(404, 'UnknownSchema', 'Unknown certificate schema version.');
      if (draft.retired_at) throw new SchemaError(409, 'SchemaRetired', 'The schema is retired.');
      if (draft.registered_at)
        throw new SchemaError(409, 'AlreadyRegistered', 'The version is registered.');
      if (expectedFields && !isDeepStrictEqual(draft.fields, expectedFields))
        throw new SchemaError(409, 'DraftChanged', 'The draft changed during publication.');
      if (!(await registry.contains(id)))
        throw new SchemaError(409, 'NotInTsr', 'The version is unavailable in TSR.');

      const result = await transaction(database, async (client) => {
        await authorize(client, actor);
        const schema = await lockSchema(client, type);
        const { rowCount } = await client.query(
          `
          UPDATE certificate_schema_versions SET tsr_id = $3, registered_at = statement_timestamp()
          WHERE schema_id = $1 AND version = $2 AND registered_at IS NULL AND fields = $4::jsonb
        `,
          [schema.id, version, id, JSON.stringify(draft.fields)],
        );
        if (!rowCount)
          throw new SchemaError(409, 'DraftChanged', 'The draft changed during confirmation.');
        await record(client, 'schema_registered', type, version, actor);
        return (await overview(client, type))[0];
      });
      try {
        await options.registered?.(type);
      } catch {
        options.reportIntegrationError?.('published schema accreditation refresh');
      }
      return result;
    },

    /**
     * Prevent a schema from being offered for new issuance.
     *
     * @param actor - RootTAO operator account ID.
     * @param input - Credential-type name.
     * @returns The retired schema overview.
     * @throws SchemaError for unknown/retired schemas or lost authority; database errors.
     */
    async retire(actor: number, input: Record<string, unknown>) {
      const type = text(input.credential_type, 101);
      return transaction(database, async (client) => {
        await authorize(client, actor);
        const schema = await lockSchema(client, type);
        await client.query(
          `
          UPDATE certificate_schemas SET retired_at = statement_timestamp(), retired_by = $2 WHERE id = $1
        `,
          [schema.id, actor],
        );
        await record(client, 'schema_retired', type, null, actor);
        return (await overview(client, type))[0];
      });
    },
  };
  return management;
}
