import type { Pool } from 'pg';
import type { SchemaField } from './types.ts';
/**
 * Create the public registered-schema name catalog.
 *
 * @param database - PostgreSQL query executor.
 * @returns A names operation including registered versions of retired types.
 */
export function postgresSchemaCatalog(database: Pick<Pool, 'query'>) {
  return {
    /**
     * Combine public labels from registered versions without exposing drafts.
     *
     * @returns Credential type names and their published field labels.
     * @throws Database errors if a query, lock or commit fails.
     */
    async names() {
      const { rows } = await database.query<{
        credential_type: string;
        name_sk: string;
        name_en: string;
        published_fields: SchemaField[][];
      }>(`
        SELECT s.credential_type, s.name_sk, s.name_en, COALESCE((
          SELECT jsonb_agg(v.fields ORDER BY v.version)
          FROM certificate_schema_versions v
          WHERE v.schema_id = s.id AND v.registered_at IS NOT NULL
        ), '[]'::jsonb) AS published_fields
        FROM certificate_schemas s
        ORDER BY s.credential_type COLLATE "C"
      `);

      return rows.map(({ credential_type, name_sk, name_en, published_fields }) => {
        const labels = new Map();
        for (const fields of published_fields) {
          for (const { key, label } of fields) {
            if (key && (label?.sk || label?.en)) {
              labels.set(key, { sk: label.sk ?? '', en: label.en ?? '' });
            }
          }
        }
        return {
          credential_type,
          name: { sk: name_sk, en: name_en },
          labels: Object.fromEntries(labels),
        };
      });
    },
  };
}
