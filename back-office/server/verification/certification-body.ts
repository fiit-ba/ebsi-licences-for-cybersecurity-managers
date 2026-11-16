import type { Pool } from 'pg';
import { evidenceTime } from './outcomes.ts';

/**
 * Observe certification-body evidence from the existing certificate/organization model.
 * @param database - Read-only PostgreSQL executor.
 * @returns A lookup using both certificate IDs and accreditation at issuance, plus live revocation.
 */
export function postgresCertificationBody(database: Pick<Pool, 'query'>) {
  /**
   * Read the certificate's recorded TI without substituting its current accreditation for history.
   * @param vc - Signature-verified credential.
   * @param issuer - Signature-verified issuer DID.
   * @param now - Evaluation time.
   * @returns Public certification-body evidence or null for an unrecorded external certificate.
   * @throws Database errors; the owning verifier maps these to an indeterminate result.
   */
  return async function certificationBody(vc: Record<string, any>, issuer: string, now: Date) {
    const {
      rows: [row],
    } = await database.query(
      `
      SELECT ti.name, c.created_at, c.issuer_accredited_until, ti.accredited_until,
        revoked.name AS revoked_name, revoked.kind AS revoked_kind, revoked.revoked_at
      FROM registered_certificates c
      JOIN accredited_organizations ti ON ti.id = c.issuer_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE chain AS (
          SELECT id, parent_id, name, kind, revoked_at FROM accredited_organizations WHERE id=ti.id
          UNION ALL
          SELECT o.id, o.parent_id, o.name, o.kind, o.revoked_at FROM accredited_organizations o JOIN chain ON chain.parent_id=o.id
        ) SELECT name, kind, revoked_at FROM chain WHERE revoked_at <= $3 ORDER BY revoked_at LIMIT 1
      ) revoked ON true
      WHERE (c.credential_id=$1 OR c.registered_id=$1) AND c.issuer_did=$2
    `,
      [vc.id, issuer, now],
    );
    if (!row) return null;
    return {
      recorded: true,
      name: row.name,
      issued_at: evidenceTime(+row.created_at),
      accredited_until_at_issuance: row.issuer_accredited_until
        ? evidenceTime(+row.issuer_accredited_until)
        : null,
      accredited_at_issuance:
        !row.issuer_accredited_until || row.created_at < row.issuer_accredited_until,
      accredited_until: row.accredited_until ? evidenceTime(+row.accredited_until) : null,
      in_force_now: !row.revoked_at && (!row.accredited_until || row.accredited_until > now),
      revoked_at: row.revoked_at ? evidenceTime(+row.revoked_at) : null,
      revoked_organization: row.revoked_name ?? null,
      revoked_organization_kind:
        ({ rtao: 'RootTAO', tao: 'TAO', ti: 'TI' } as Record<string, string>)[row.revoked_kind] ??
        null,
    };
  };
}
