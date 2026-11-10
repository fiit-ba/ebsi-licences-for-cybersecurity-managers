export type Revocation = { at: string | null; byTao: boolean }
export type Organization = {
  username: string
  organization: string
  accreditedUntil?: string | null
  accreditationEnded?: boolean
  revoked?: Revocation | null
}
export type AccreditationState =
  | { kind: 'unknown' }
  | { kind: 'unlimited' }
  | { kind: 'valid'; until: string; days: number }
  | { kind: 'ending'; until: string; days: number }
  | { kind: 'ended'; until: string | null }
  | { kind: 'revoked'; at: string | null; byTao: boolean }
export type ProfileKind = 'holder' | 'organization'
export type Texts = { sk: string; en: string }
export type SchemeField = {
  key: string
  kind: 'text' | 'date' | 'integer'
  section: 'holder' | 'training' | 'certificate'
  required: boolean
  default: string
  organization: boolean
  label?: Texts
  hint?: Texts
}
export type Schema = { credential_type: string; name: Texts; version: number; fields: SchemeField[] }
export type Scheme = {
  schemas: Schema[]
  organization: string
  accreditedUntil?: string | null
  accreditationEnded?: boolean
}
export type Offer = { offerUri: string; qr: string; pin: string | null; expiresAt: string; credentialId: string }
export const ENDING_SOON_DAYS = 30
export const accreditationState = (
  until: string | null | undefined,
  ended?: boolean,
  now: number = Date.now(),
  revoked?: Revocation | null,
): AccreditationState => {
  if (revoked) return { kind: 'revoked', at: revoked.at, byTao: revoked.byTao }
  if (ended) return { kind: 'ended', until: until ?? null }
  if (until === undefined) return { kind: 'unknown' }
  if (until === null) return { kind: 'unlimited' }
  const left = new Date(until).getTime() - now
  if (Number.isNaN(left)) return { kind: 'unknown' }
  if (left <= 0) return { kind: 'ended', until }
  const days = Math.ceil(left / 86_400_000)
  return days <= ENDING_SOON_DAYS ? { kind: 'ending', until, days } : { kind: 'valid', until, days }
}
