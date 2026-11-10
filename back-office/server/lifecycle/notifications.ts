import type { Pool, PoolClient } from 'pg';
import type { OperatorNotification, OperatorNotifications } from '../../shared/notifications.ts';
import { transaction } from '../adapters/transaction.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { IssuanceError } from '../issuance/claims.ts';
import type { Protection } from '../issuance/protection.ts';

const operatorRoles = [
  'plr_issuer',
  'plr_status_manager',
  'plr_verifier',
  'plr_auditor',
  'plr_rtao',
  'plr_tao',
];

/** Database notification projection before conversion to the public timestamp format. */
type NotificationRow = Omit<OperatorNotification, 'proposed_at'> & {
  proposed_at: Date;
  claims_certificate_id: string;
  claims_private_data: Buffer;
};

/**
 * Create the existing sign-in notification read contract using one consistent snapshot.
 *
 * @param database - PostgreSQL connection pool.
 * @param protection - Configured claims protection; unprotected domain fixtures retain their public number label.
 * @returns A current-operator reader returning the newest ten open requests and complete counts.
 * @remarks An organization's notices follow its TI/TAO scope; RootTAO and operators without an
 * organization see all open requests. These read rules do not grant emergency authority.
 */
export function postgresNotifications(database: Pool, protection?: Protection) {
  /**
   * Read the operator's visible pending requests without reasons or holder attributes.
   *
   * @param actor - Current operator account ID; roles and inherited revocation are reread.
   * @returns Public notice items, visible total and the number awaiting this operator's approval.
   * @throws IssuanceError for inactive/revoked accounts or missing product roles; database errors.
   * @remarks Approval eligibility excludes the proposer and already approved requests, matching
   * the notification response contract. The decision operation independently revalidates standing.
   */
  async function notifications(actor: number): Promise<OperatorNotifications> {
    return transaction(database, async (client: PoolClient) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const account = await postgresAccounts(client).byId(actor);
      if (!account?.active || account.revoked_at)
        throw new IssuanceError(401, 'InactiveAccount', 'An active operator account is required.');
      if (!operatorRoles.some((role) => account.roles.includes(role)))
        throw new IssuanceError(
          403,
          'RoleRequired',
          'This needs one of these roles: plr_issuer, plr_status_manager, plr_verifier, plr_auditor, plr_rtao, plr_tao.',
        );

      const scope = `
        FROM certificate_status_proposals p
        JOIN registered_certificates c ON c.id = p.certificate_id
        JOIN accredited_organizations issuer ON issuer.id = c.issuer_id
        JOIN operator_accounts proposer ON proposer.id = p.proposed_by
        LEFT JOIN accredited_organizations owner ON owner.account_id = $1
        WHERE p.applied_at IS NULL AND p.closed_at IS NULL AND p.decision IS DISTINCT FROM 'rejected'
          AND (owner.id IS NULL OR owner.kind = 'rtao'
            OR (owner.kind = 'tao' AND issuer.parent_id = owner.id)
            OR (owner.kind = 'ti' AND issuer.id = owner.id))
      `;
      const approver = account.roles.includes('plr_status_manager');
      const {
        rows: [counts],
      } = await client.query<{ total: number; waiting: number }>(
        `SELECT count(*)::integer AS total,
          count(*) FILTER (WHERE $2::boolean AND p.decision IS NULL AND p.proposed_by <> $1)::integer AS waiting
        ${scope}`,
        [actor, approver],
      );
      const { rows } = await client.query<NotificationRow>(
        `SELECT p.id AS proposal_id, c.credential_id, c.certificate_number AS reference,
          c.id AS claims_certificate_id,c.private_data AS claims_private_data,
          issuer.name AS issuer, p.action, proposer.username AS proposed_by, p.proposed_at,
          COALESCE(p.decision = 'approved', false) AS approved,
          p.onchain_proposal_id::text, p.onchain_state,
          $2::boolean AND p.decision IS NULL AND p.proposed_by <> $1 AS can_approve
        ${scope} ORDER BY p.proposed_at DESC, p.id DESC LIMIT 10`,
        [actor, approver],
      );
      return {
        items: await Promise.all(
          rows.map(async ({ claims_certificate_id, claims_private_data, ...row }) => ({
            ...row,
            reference: protection
              ? ((await protection.open(claims_certificate_id, claims_private_data)).claims
                  .certificateNumber ?? '')
              : row.reference,
            proposed_at: row.proposed_at.toISOString(),
          })),
        ),
        ...counts,
      };
    });
  }
  return notifications;
}
