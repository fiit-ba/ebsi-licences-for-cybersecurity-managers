import type { Pool } from 'pg';
/**
 * Create a local issuer-revocation overlay for credential verification.
 *
 * @param database - PostgreSQL query executor.
 * @returns A DID lookup returning whether the issuer or its ancestor is revoked.
 */
export function postgresIssuerRevocation(database: Pick<Pool, 'query'>) {
  /**
   * Check local issuer and ancestor revocation independently of external registries.
   *
   * @param did - Credential issuer DID.
   * @returns Whether the issuer trust chain has an effective revocation.
   * @throws Database query errors.
   */
  async function isIssuerRevoked(did: string) {
    const {
      rows: [{ revoked }],
    } = await database.query(
      `
      SELECT EXISTS (
        SELECT 1 FROM accredited_organizations ti
        JOIN accredited_organizations tao ON tao.id = ti.parent_id
        JOIN accredited_organizations root ON root.id = tao.parent_id
        WHERE ti.kind = 'ti' AND ti.did = $1 AND EXISTS (
          SELECT 1 FROM (VALUES (ti.revoked_at), (tao.revoked_at), (root.revoked_at)) AS chain(revoked_at)
          WHERE revoked_at <= statement_timestamp()
        )
      ) AS revoked
    `,
      [did],
    );
    return revoked;
  }
  return isIssuerRevoked;
}
