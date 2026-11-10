import { AccreditationError } from './invitations.ts';
import type { Pool } from 'pg';
import type { OrganizationRow, OrganizationView, ScopedOrganizationRow } from './types.ts';

/**
 * Summarize an organization's effective accreditation and inherited revocation.
 *
 * @param row - Organization row.
 * @param now - Observation time.
 * @param revoked - Nearest revoked ancestor, if any.
 * @returns Accreditation end and public revocation context.
 */
function authority(row: OrganizationRow, now: Date, revoked?: OrganizationRow) {
  return {
    accredited_until: row.accredited_until,
    accreditation_ended: Boolean(revoked || (row.accredited_until && row.accredited_until <= now)),
    revoked: revoked
      ? {
          revoked_at: revoked.revoked_at,
          reason: revoked.revocation_reason,
          note: revoked.revocation_note,
          own: revoked.id === row.id,
          organization: revoked.name,
          organization_kind: revoked.kind,
        }
      : null,
  };
}

/**
 * Create a scoped accreditation-hierarchy reader.
 *
 * @param database - PostgreSQL query executor.
 * @returns A reader for the operator organization, grants and descendants.
 */
export function postgresTrustChain(database: Pick<Pool, 'query'>) {
  return {
    /**
     * Read a selector and its descendants from one database snapshot.
     *
     * @param actorId - RootTAO or TAO account ID.
     * @returns The organization, selectable child kind, available schemas and child tree.
     * @throws AccreditationError if the actor has no active accrediting organization; database
     * errors.
     */
    async read(actorId: number) {
      // One snapshot for the selector, grants and descendants. The schema
      // enforces the maximum depth and the permitted parent kinds.
      const { rows } = await database.query<ScopedOrganizationRow>(
        `
        WITH RECURSIVE scope AS (
          SELECT o.*, 0 AS depth
          FROM accredited_organizations o
          JOIN operator_accounts a ON a.id = o.account_id AND a.active
          JOIN operator_roles r ON r.account_id = a.id
          LEFT JOIN accredited_organizations p ON p.id = o.parent_id
          WHERE a.id = $1 AND o.kind IN ('rtao', 'tao')
            AND r.role = 'plr_' || o.kind
            AND (o.revoked_at IS NULL OR o.revoked_at > statement_timestamp())
            AND (p.revoked_at IS NULL OR p.revoked_at > statement_timestamp())
          UNION ALL
          SELECT child.*, scope.depth + 1
          FROM accredited_organizations child JOIN scope ON child.parent_id = scope.id
        )
        SELECT scope.*, account.username AS account, selector.username AS selector,
          statement_timestamp() AS observed_at,
          ARRAY(
            SELECT s.credential_type
            FROM organization_certificate_schemas g JOIN certificate_schemas s ON s.id = g.schema_id
            WHERE g.organization_id = scope.id
            ORDER BY s.credential_type
          ) AS schemas,
          CASE WHEN scope.depth = 0 THEN ARRAY(
            SELECT jsonb_build_object(
              'credential_type', s.credential_type,
              'name', jsonb_build_object('sk', s.name_sk, 'en', s.name_en)
            )
            FROM certificate_schemas s
            WHERE s.retired_at IS NULL AND (scope.kind = 'rtao' OR EXISTS (
              SELECT 1 FROM organization_certificate_schemas g
              WHERE g.schema_id = s.id AND g.organization_id = scope.id
            ))
            ORDER BY s.name_sk, s.credential_type
          ) END AS available_schemas
        FROM scope
        LEFT JOIN operator_accounts account ON account.id = scope.account_id
        LEFT JOIN operator_accounts selector ON selector.id = scope.selected_by
        ORDER BY scope.depth, scope.selected_at, scope.id
      `,
        [actorId],
      );
      const [organization, ...descendants] = rows;
      if (!organization) {
        throw new AccreditationError(
          403,
          'NoOrganization',
          'An accrediting organization is required.',
        );
      }

      const now = organization.observed_at;
      const children = new Map<string | null, ScopedOrganizationRow[]>();
      for (const row of descendants) {
        const siblings = children.get(row.parent_id) ?? [];
        siblings.push(row);
        children.set(row.parent_id, siblings);
      }
      /**
       * Serialize a child while carrying inherited revocation down its branch.
       *
       * @param row - Organization row from the scoped query.
       * @param inheritedRevocation - Nearest already revoked ancestor, if any.
       * @returns Public organization fields and nested TI children.
       */
      function serialize(
        row: ScopedOrganizationRow,
        inheritedRevocation?: OrganizationRow,
      ): OrganizationView {
        const revoked = row.revoked_at && row.revoked_at <= now ? row : inheritedRevocation;
        return {
          organization_id: row.id,
          name: row.name,
          kind: row.kind,
          contact_email: row.contact_email,
          selected_by: row.selector,
          selected_at: row.selected_at,
          account: row.account,
          registered_at: row.registered_at,
          invitation_expires_at: row.account ? null : row.invitation_expires_at,
          schemas: row.schemas,
          did: row.did,
          is_issuer: row.kind === 'ti' && Boolean(row.did && row.tir_attribute_id),
          ...authority(row, now, revoked),
          ...(row.kind === 'tao'
            ? {
                accredited: (children.get(row.id) ?? []).map((child) => serialize(child, revoked)),
              }
            : {}),
        };
      }
      return {
        organization: {
          name: organization.name,
          kind: organization.kind,
          ...authority(organization, now),
        },
        selects: organization.kind === 'rtao' ? 'tao' : 'ti',
        available_schemas: organization.available_schemas,
        accredited: (children.get(organization.id) ?? []).map((row) => serialize(row)),
      };
    },
  };
}
