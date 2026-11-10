import { Organization, Revocation } from '@domain/organization/organization'
import { StoredProfile } from './organizationProfile.repository'
export const visibleOrganization = (stored: StoredProfile): Organization => ({
  username: stored.username,
  organization: stored.organization,
  accreditedUntil: stored.accreditedUntil,
  accreditationEnded: stored.accreditationEnded,
  revoked: stored.revoked ?? null,
})
export const revocationFromResponse = (data: any): Revocation | null => {
  if (data?.reason === 'AccreditationRevoked')
    return { at: data.revoked_at ?? null, byTao: data.revoked_organization_kind === 'tao' }
  if (data?.revoked && typeof data.revoked === 'object')
    return { at: data.revoked.revoked_at ?? null, byTao: data.revoked.own === false }
  return null
}
