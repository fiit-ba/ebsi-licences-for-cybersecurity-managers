import type { Pool } from 'pg';
import type { OperatorAccount } from '../identity/auth/accounts.ts';
import type { PublishedSchema } from '../schemas/types.ts';
import { organizationProfile } from '../accreditation/profile.ts';

export const defaultCredentialType = 'CybersecurityManagerCertificate';

/**
 * Create a reader for published schemas granted to a TI.
 *
 * @param database - PostgreSQL query executor.
 * @returns An availableTo lookup returning usable schema definitions.
 */
export function postgresIssuanceSchemes(database: Pick<Pool, 'query'>) {
  return {
    /**
     * Read currently usable published schemas for an issuer account.
     *
     * @param accountId - Issuer operator account ID.
     * @returns Published schema names, versions and field definitions.
     * @throws Database errors if a query, lock or commit fails.
     */
    async availableTo(accountId: number) {
      const { rows } = await database.query<PublishedSchema>(
        `
        SELECT s.credential_type, jsonb_build_object('sk', s.name_sk, 'en', s.name_en) AS name,
          published.version, published.fields
        FROM accredited_organizations ti
        JOIN accredited_organizations tao ON tao.id = ti.parent_id
        JOIN accredited_organizations root ON root.id = tao.parent_id
        JOIN organization_certificate_schemas g ON g.organization_id = ti.id
        JOIN certificate_schemas s ON s.id = g.schema_id
        JOIN LATERAL (
          SELECT version, fields
          FROM certificate_schema_versions
          WHERE schema_id = s.id AND registered_at IS NOT NULL
          ORDER BY version DESC LIMIT 1
        ) published ON true
        WHERE ti.account_id = $1 AND ti.kind = 'ti' AND s.retired_at IS NULL
          AND (ti.accredited_until IS NULL OR ti.accredited_until > statement_timestamp())
          AND NOT EXISTS (
            SELECT 1 FROM (VALUES (ti.revoked_at), (tao.revoked_at), (root.revoked_at)) AS chain(revoked_at)
            WHERE revoked_at <= statement_timestamp()
          )
          AND EXISTS (
            SELECT 1 FROM organization_certificate_schemas parent_grant
            WHERE parent_grant.organization_id = tao.id AND parent_grant.schema_id = s.id
          )
        ORDER BY s.name_sk, s.credential_type
      `,
        [accountId],
      );
      return rows;
    },
  };
}

/**
 * Return the compatibility schema response for an eligible issuer.
 *
 * @param account - Authenticated account including roles and organization.
 * @param store - Published issuance-scheme store.
 * @returns Schema choices, compatibility primary fields and organization accreditation state.
 * @throws Database errors if a query, lock or commit fails.
 */
export async function issuanceScheme(
  account: OperatorAccount,
  store: ReturnType<typeof postgresIssuanceSchemes>,
) {
  const profile = organizationProfile(account);
  const schemas =
    profile.organization_kind === 'ti' && !profile.accreditation_ended
      ? await store.availableTo(account.id)
      : [];
  const first =
    schemas.find((schema) => schema.credential_type === defaultCredentialType) ?? schemas[0];
  return {
    schemas,
    credential_type: first?.credential_type ?? defaultCredentialType,
    fields: first?.fields ?? [],
    organization: profile.organization,
    accredited_until: profile.accredited_until,
    accreditation_ended: profile.accreditation_ended,
    revoked: profile.revoked,
  };
}
