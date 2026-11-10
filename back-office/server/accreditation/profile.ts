import type { OperatorAccount } from '../identity/auth/accounts.ts';
import type { OrganizationKind } from './types.ts';

const suspension: Record<OrganizationKind, { role: string; scope: string }> = {
  rtao: { role: 'plr_rtao', scope: 'all' },
  tao: { role: 'plr_tao', scope: 'selected' },
  ti: { role: 'plr_status_manager', scope: 'own' },
};

/**
 * Serialize the organization fields exposed by the operator profile.
 *
 * @param account - Account row including organization and revocation context.
 * @returns Public organization, accreditation and revocation fields.
 */
export function organizationProfile(account: OperatorAccount) {
  const authority = account.organization_kind ? suspension[account.organization_kind] : undefined;
  return {
    organization: account.organization_name ?? '',
    organization_kind: account.organization_kind ?? '',
    organization_did: account.organization_did ?? '',
    accredited_until: account.accredited_until ?? null,
    accreditation_ended: account.accreditation_ended ?? false,
    revoked: null,
    emergency_suspension_scope:
      authority && account.roles.includes(authority.role) ? authority.scope : '',
  };
}

/**
 * Build the authentication refusal for a revoked organization chain.
 *
 * @param account - Account row with inherited revocation context.
 * @returns A refusal body when revoked, otherwise undefined.
 */
export function accreditationRefusal(account?: OperatorAccount) {
  if (!account?.revoked_at) return;
  const date = account.revoked_at.toISOString();
  return {
    detail: `The accreditation of ${account.revoked_name} was revoked on ${date.slice(0, 10)}.`,
    reason: 'AccreditationRevoked',
    revoked_at: date,
    revoked_organization_kind: account.revoked_kind,
  };
}
