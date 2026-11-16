import { IssuanceError } from '../issuance/claims.ts';
import {
  certificateOrganizations,
  certificateReaderAccess,
  statusManagerAccess,
  emergencyAccess,
  pendingEmergency,
} from './access.ts';
import { statusActions } from './proposals.ts';
import type { Pool } from 'pg';
import type { Protection } from '../issuance/protection.ts';
import { transaction } from '../adapters/transaction.ts';

const pageSize = 500;

/**
 * Parse a numeric query parameter and clamp it to safe bounds.
 *
 * @param input - Untrusted query text or null.
 * @param fallback - Value used for invalid input.
 * @param lower - Inclusive minimum.
 * @param upper - Inclusive maximum.
 * @returns The bounded safe integer or fallback.
 */
function bounded(input: string | null, fallback: number, lower: number, upper: number) {
  const value = typeof input === 'string' && /^[+-]?\d+$/.test(input.trim()) ? Number(input) : NaN;
  return Number.isSafeInteger(value) ? Math.min(upper, Math.max(lower, value)) : fallback;
}

const scoped = `
  FROM registered_certificates c ${certificateOrganizations}
  LEFT JOIN credential_tokens token ON token.certificate_id = c.id
  WHERE (${certificateReaderAccess})
`;

/** Committed registry lifecycle state; verification separately observes the ledger. */
type CertificateState = 'active' | 'suspended' | 'revoked' | 'unknown';

/** Database projection used to build an authorized certificate registry response. */
interface CertificateListRow {
  credential_id: string;
  registered_id: string | null;
  holder_reference: string;
  reference: string;
  certification_body: string;
  state: CertificateState;
  effective_state: CertificateState | 'expired';
  issued_at: Date;
  valid_until: Date | null;
  collected: boolean;
  allowed_actions: string[];
  has_open_proposal: boolean;
  can_emergency_suspend: boolean;
  can_reoffer: boolean;
}

/**
 * Create a scoped certificate registry reader with private reference decryption.
 *
 * @param database - PostgreSQL pool.
 * @param protection - Protection used to decrypt stored references.
 * @param options - Captured lifecycle execution mode; registry reads retain local state in either mode.
 * @returns An actor/query reader returning rows, summary counts, pagination and unreadable count.
 */
export function postgresCertificateList(
  database: Pool,
  protection: Protection,
  options: { governanceEnabled?: boolean } = {},
) {
  void options;
  const displayedStates = 'c.local_standing';
  /**
   * Read only authorized certificates, decrypt references and apply scoped search/pagination.
   *
   * @param accountId - Current operator account ID.
   * @param query - Search, standing filter, limit and offset.
   * @returns Visible certificate rows, summary counts, pagination and unreadable count.
   * @throws Database errors; individual decryption failures are counted and omitted.
   */
  async function listCertificates(accountId: number, query: URLSearchParams) {
    const limit = bounded(query.get('limit'), 100, 1, 500);
    const offset = bounded(query.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER - 500);
    const filter = query.get('state') || null;
    const term = query.get('q')?.trim().toLowerCase();
    return transaction(database, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {
        rows: [summary],
      } = await client.query(
        `
        SELECT count(*)::integer AS "all",
          count(*) FILTER (WHERE state = 'active' AND collected AND NOT expired)::integer AS valid,
          count(*) FILTER (WHERE state = 'suspended')::integer AS suspended,
          count(*) FILTER (WHERE state = 'revoked')::integer AS revoked
        FROM (
          SELECT ${displayedStates} AS state, token.redeemed_at IS NOT NULL AS collected,
            COALESCE(c.valid_until <= transaction_timestamp(), false) AS expired
          ${scoped}
        ) available
      `,
        [accountId],
      );
      const results: CertificateListRow[] = [];
      let unreadable = 0;
      let total = 0;
      if (!term) {
        const {
          rows: [count],
        } = await client.query(
          `
          SELECT count(*)::integer AS total ${scoped}
          AND ($2::text IS NULL OR (${displayedStates}) = $2)
        `,
          [accountId, filter],
        );
        total = count.total;
      }

      // Holder references are encrypted. Search only rows in this account's
      // scope, scanning in bounded batches under the same database snapshot.
      for (let cursor = term ? 0 : offset; ; cursor += pageSize) {
        const { rows } = await client.query(
          `
          SELECT c.id, c.credential_id, c.registered_id, c.certificate_number, c.created_at, c.valid_until, c.private_data,
            ti.name AS certification_body, token.redeemed_at IS NOT NULL AS collected,
            COALESCE(c.valid_until <= transaction_timestamp(), false) AS expired, ${displayedStates} AS state,
            (${statusManagerAccess}) AS can_manage,
            (${emergencyAccess}) AS can_emergency,
            (${pendingEmergency}) AS emergency_pending,
            EXISTS (
              SELECT 1 FROM operator_accounts a JOIN operator_roles role ON role.account_id = a.id
              WHERE a.id = $1 AND a.active AND role.role = 'plr_issuer' AND ti.account_id = a.id
                AND (LEAST(ti.revoked_at, tao.revoked_at, root.revoked_at) IS NULL
                  OR LEAST(ti.revoked_at, tao.revoked_at, root.revoked_at) > statement_timestamp())
                AND token.redeemed_at IS NULL AND (c.valid_until IS NULL OR c.valid_until > statement_timestamp())
                AND EXISTS (SELECT 1 FROM credential_offers offer WHERE offer.certificate_id = c.id)
            ) AS can_reoffer,
            EXISTS (
              SELECT 1 FROM certificate_status_proposals p WHERE p.certificate_id = c.id
                AND p.applied_at IS NULL AND p.closed_at IS NULL AND p.decision IS DISTINCT FROM 'rejected'
            ) AS has_open_proposal
          ${scoped}
          AND ($2::text IS NULL OR (${displayedStates}) = $2)
          ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $4
        `,
          [accountId, filter, term ? pageSize : limit, cursor],
        );
        for (const row of rows) {
          let data;
          try {
            data = await protection.open(row.id, row.private_data);
          } catch (error) {
            if (error instanceof IssuanceError && error.status === 503) throw error;
            unreadable++;
            continue;
          }
          const reference = String(
            data.claims.certificateNumber || data.claims.registrationNumber || '',
          );
          if (term) {
            const searchable = [
              reference,
              data.holder_reference,
              row.credential_id,
              row.registered_id,
            ]
              .join(' ')
              .toLowerCase();
            if (!searchable.includes(term)) continue;
            const index = total++;
            if (index < offset || index >= offset + limit) continue;
          }
          results.push({
            credential_id: row.credential_id,
            registered_id: row.registered_id,
            holder_reference: data.holder_reference,
            reference,
            certification_body: String(data.claims.certificationBody ?? ''),
            state: row.state,
            effective_state: row.state === 'active' && row.expired ? 'expired' : row.state,
            issued_at: row.created_at,
            valid_until: row.valid_until,
            collected: row.collected,
            allowed_actions: statusActions(row.state),
            has_open_proposal: row.has_open_proposal,
            can_emergency_suspend: row.can_emergency,
            can_reoffer: row.can_reoffer,
          });
        }
        if (!term || rows.length < pageSize) break;
      }
      return {
        count: results.length,
        total,
        next: offset + limit < total ? offset + limit : null,
        results,
        unreadable,
        summary,
      };
    });
  }
  return listCertificates;
}
