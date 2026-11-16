import type { Pool } from 'pg';
import type { SchemaField } from './types.ts';
import type { DevelopmentSupportOffice } from '../ebsi/support-office.ts';
import { transaction } from '../adapters/transaction.ts';

/** TSR id of the schema of a registry certificate's `credentialStatus` (its record on chain). */
export const ledgerStatusEntrySchemaId = 'zPlrCertificateStatusEntryV4';

/**
 * A registry certificate's status: one entry naming the certificate registry its record is on.
 * A verifier computes the record's key from the issuer and the credential's id, so the entry
 * carries no key (V4); V3 named the governance contract and a key.
 */
export const ledgerStatusEntrySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Certificate Record on the Certificate Registry',
  description:
    'Validates the credentialStatus of a registry certificate: its one entry, the certificate registry that keeps its record, the only source of truth about it.',
  type: 'object',
  properties: {
    credentialStatus: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          type: { const: 'PlrLedgerStatusEntry' },
          chainId: { type: 'integer', minimum: 1 },
          contract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
        },
        required: ['id', 'type', 'chainId', 'contract'],
        not: { required: ['statusKey'] },
      },
    },
  },
  required: ['credentialStatus'],
};

/** TSR id of the schema of the trust chain's accreditations. */
export const accreditationSchemaId = 'zPlrAccreditationV1';

/** The trust chain's credentials: a Verifiable Attestation naming its subject. */
export const accreditationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Accreditation in the Professional License Registry trust chain',
  type: 'object',
  properties: {
    type: { type: 'array', items: { type: 'string' } },
    issuer: { type: 'string' },
    credentialSubject: { type: 'object', required: ['id'] },
  },
  required: ['type', 'issuer', 'credentialSubject'],
};

/** Versioned schema document offered to the development registry. */
export interface SchemaPublication {
  credential_type: string;
  name: { sk: string; en: string };
  versions: {
    version: number;
    fields: SchemaField[];
    tsr_id: string;
    registered_at: Date | null;
  }[];
  pending_version: number | null;
}

/**
 * Render the existing credential JSON Schema contract without requiring newly added subject fields.
 * @param schema - Schema name/type and pending version.
 * @returns The draft-2020-12 document consumed by the TSR and credential validator.
 * @throws Error if no pending version exists.
 */
export function credentialSchemaDocument(schema: SchemaPublication) {
  const version = schema.versions.find((item) => item.version === schema.pending_version);
  if (!version) throw new Error('No pending schema version.');
  const properties: Record<string, unknown> = { id: { type: 'string' } };
  for (const field of version.fields) {
    properties[field.key] =
      field.kind === 'date'
        ? { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
        : field.kind === 'integer'
          ? { type: 'integer', minimum: 1 }
          : { type: 'string', ...(field.required ? { minLength: 1 } : {}) };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: schema.name.en || schema.name.sk,
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: {
        type: 'array',
        items: { type: 'string' },
        contains: { const: schema.credential_type },
      },
      issuer: { type: 'string' },
      credentialSubject: { type: 'object', properties, required: ['id'] },
    },
    required: ['type', 'issuer', 'credentialSubject'],
  };
}

/**
 * Create development TSR publication through the Support Office.
 * @param supportOffice - Development Support Office, which registers schemas on EBSI.
 * @returns A publisher acknowledging the deterministic version identifier.
 * @remarks Schema registration on EBSI is not self-service (component 7): the Support Office
 * registers a submitted proposal. TI accreditations are widened to the new version afterwards.
 */
export function supportOfficeSchemaPublication(supportOffice: DevelopmentSupportOffice) {
  /**
   * Register one inspected draft.
   * @param schema - Exact draft snapshot inspected by the manager.
   * @returns Its deterministic TSR identifier after registry acknowledgement.
   * @throws Registry or schema errors; the manager keeps a retryable draft.
   */
  return async function publish(schema: SchemaPublication) {
    const version = schema.versions.find((item) => item.version === schema.pending_version);
    if (!version) throw new Error('No pending schema version.');
    const stem = schema.credential_type.replace(/Certificate$/, '') || schema.credential_type;
    const id = version.tsr_id || `zPlr${stem}V${version.version}`;
    await supportOffice.registerSchema(id, credentialSchemaDocument(schema));
    return id;
  };
}

/**
 * Register every published schema version, and the platform's own schemas, in the TSR.
 * @param database - PostgreSQL pool containing the authoritative version history.
 * @param supportOffice - Development Support Office.
 * @returns Number of registered certificate schema versions, including retired schemas; drafts
 * remain unpublished.
 * @throws Database or registry errors; the operation is safe to retry with the same version IDs.
 */
export async function synchronizeSchemas(database: Pool, supportOffice: DevelopmentSupportOffice) {
  await supportOffice.registerSchema(ledgerStatusEntrySchemaId, ledgerStatusEntrySchema);
  await supportOffice.registerSchema(accreditationSchemaId, accreditationSchema);
  return transaction(database, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(651907,0)');
    const { rows } =
      await client.query(`SELECT s.credential_type,s.name_sk,s.name_en,v.version,v.fields,v.tsr_id,v.registered_at
      FROM certificate_schemas s JOIN certificate_schema_versions v ON v.schema_id=s.id
      WHERE v.registered_at IS NOT NULL ORDER BY s.credential_type,v.version`);
    for (const row of rows)
      await supportOffice.registerSchema(
        row.tsr_id,
        credentialSchemaDocument({
          credential_type: row.credential_type,
          name: { sk: row.name_sk, en: row.name_en },
          pending_version: row.version,
          versions: [row],
        }),
      );
    return rows.length;
  });
}
