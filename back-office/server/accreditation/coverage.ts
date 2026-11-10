import type { Pool } from 'pg';

/**
 * Read every published version needed by current grants or historically issued credentials.
 * @param database - PostgreSQL query executor.
 * @param schemaAddress - Trusted TSR identifier-to-address operation.
 * @param organization - TI UUID; omit for the registry's complete historical coverage.
 * @returns Stable schema/type coverage, including retired versions needed for verification.
 * @throws Database or address-validation errors.
 */
export async function accreditationCoverage(
  database: Pick<Pool, 'query'>,
  schemaAddress: (id: string) => string,
  organization?: string,
) {
  const { rows } = await database.query<{ tsr_id: string; credential_type: string }>(
    `
    SELECT v.tsr_id, s.credential_type FROM certificate_schema_versions v
    JOIN certificate_schemas s ON s.id=v.schema_id
    WHERE v.registered_at IS NOT NULL AND ($1::uuid IS NULL OR EXISTS (
      SELECT 1 FROM organization_certificate_schemas g WHERE g.organization_id=$1 AND g.schema_id=s.id
    ) OR EXISTS (
      SELECT 1 FROM registered_certificates c WHERE c.issuer_id=$1 AND c.schema_id=s.id
    )) ORDER BY s.credential_type,v.version
  `,
    [organization ?? null],
  );
  return rows.map((row) => ({
    schemaId: schemaAddress(row.tsr_id),
    types: ['VerifiableCredential', 'VerifiableAttestation', row.credential_type],
  }));
}
