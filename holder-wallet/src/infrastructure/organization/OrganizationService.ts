// An organization in the app (design decisions D15, D18): a certification body
// that issues and verifies certificates from the phone.
// The organization is a profile of its own, independent of the certificate
// holder's wallet (D18). The two live side by side: each has its own PIN, and
// deleting one leaves the other. The organization's needs no keys, DID or
// security phrase - it issues through the back-office and holds no
// certificates - so its profile is small:
// - which back-office account and organization it is;
// - a PBKDF2 hash of its PIN, with its salt;
// - its own history: the certificates it issued and verified.
// It is kept in the keychain under a service of its own, never in the
// holder's entry (utils/keychain.ts).
// Besides the profile:
// - which of the two the app shows, remembered on the device;
// - the session with the back-office, in memory only and dropped when the
//   app locks, like the holder's PIN (infrastructure/security/SessionPin.ts); the password is
//   never stored, and signing in again is the price;
// - the calls to the back-office, whose refusals become keys of the
//   Organization bundle, so nothing reaches the screen in English.
// First, as everywhere jose is used (utils/crypto.ts, utils/jwt.ts): jose reads
// the global crypto as it loads, and this module loads before the first screen
// (shared/hooks/useCachedResources.ts), ahead of anything else that would define it.
import 'react-native-get-random-values'
import { decodeJwt } from 'jose'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { ActionLog } from '@infrastructure/openid/types'
import {
  AccreditationState,
  ENDING_SOON_DAYS,
  Offer,
  Organization,
  ProfileKind,
  Revocation,
  Schema,
  Scheme,
  accreditationState,
} from '@domain/organization/organization'
import {
  deleteOrganizationProfileEntry,
  readOrganizationProfile,
  StoredProfile,
  writeOrganizationProfile,
} from './organizationProfile.repository'
import { equalPinHashes, hashOrganizationPin, newPinSalt, PIN_ITERATIONS } from './organizationPin.adapter'
import { revocationFromResponse, visibleOrganization } from './organization.mapper'
import {
  authenticateOrganization,
  createCertificateOffer,
  fetchCertificateScheme,
  fetchOrganizationAccount,
  registerOrganizationAccount,
} from './organization.client'
export type {
  AccreditationState,
  Offer,
  Organization,
  ProfileKind,
  Revocation,
  Schema,
  Scheme,
  SchemeField,
  Texts,
} from '@domain/organization/organization'
export { ENDING_SOON_DAYS, accreditationState } from '@domain/organization/organization'

/**
 * The organization's account, and until when its TI may issue (design decisions
 * D23): `accreditedUntil` is ISO, null for an authority without an end, and
 * absent for a profile saved before the app knew of ends.
 */
const ISSUER_ROLE = 'plr_issuer'
const PROFILE_KEY = 'plr.profile'
// Where the organization was kept when it was a mode of the holder's wallet.
const LEGACY_KEY = 'organization'
const MAX_LOGS = 500

let profile: StoredProfile | null = null
let active: ProfileKind = 'holder'
// Signed in on the Organization screen, its PIN not yet chosen.
let pending: Organization | null = null

/** Whether the certificate holder's wallet exists: its security phrase was confirmed. */
export const holderExists = (): Promise<boolean> => LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED)

/**
 * Read the organization's profile and which profile the app shows; the app does
 * so before its first screen, and again after a fresh install wiped the keychain.
 * A profile that is not there is not shown: the app opens the other one.
 */
export const restoreOrganization = async (): Promise<Organization | null> => {
  try {
    profile = await readOrganizationProfile()
  } catch {
    profile = null
  }
  // An organization kept as the holder wallet's mode (before D18) had no PIN of
  // its own; it signs in again and chooses one.
  await LocalStorageService.removeItem(LEGACY_KEY).catch(() => {})
  let saved = ''
  try {
    saved = await LocalStorageService.getData(PROFILE_KEY)
  } catch {
    saved = ''
  }
  active = saved === 'organization' ? 'organization' : 'holder'
  if (active === 'organization' && !profile) active = 'holder'
  if (active === 'holder' && profile && !(await holderExists())) active = 'organization'
  return currentOrganization()
}

/** The profile the app shows now. */
export const activeProfile = (): ProfileKind => active

export const setActiveProfile = async (kind: ProfileKind): Promise<void> => {
  active = kind
  if (kind === 'holder') OrgSession.clear()
  await LocalStorageService.storeData(PROFILE_KEY, kind).catch(() => {})
}

/** What of the stored profile the screens see: never its PIN or history. */
/** The organization when its profile is the one shown, else null. Its colours and tabs follow this. */
export const currentOrganization = (): Organization | null =>
  active === 'organization' && profile ? visibleOrganization(profile) : null

/** The organization's profile on this device, whichever profile is shown. */
export const organizationProfile = (): Organization | null => (profile ? visibleOrganization(profile) : null)

export const hasOrganizationProfile = (): boolean => profile !== null

/** Whether there is anything to unlock: either profile. */
export const anyProfileExists = async (): Promise<boolean> => profile !== null || (await holderExists())

/** Whether one profile exists on this device. */
export const profileExists = async (kind: ProfileKind): Promise<boolean> =>
  kind === 'holder' ? holderExists() : hasOrganizationProfile()

/**
 * Show `kind` if it exists, and say whether it did. Every switch between the
 * two profiles goes this way - the sign-in screen, registration, the header
 * menu, and after deleting one - and a caller that gets false sends the user to
 * create the profile instead.
 */
export const openProfile = async (kind: ProfileKind): Promise<boolean> => {
  if (!(await profileExists(kind))) return false
  await setActiveProfile(kind)
  return true
}

/** The organization signed in on the Organization screen, before its PIN is chosen. */
export const setPendingOrganization = (organization: Organization | null): void => {
  pending = organization
}

export const pendingOrganization = (): Organization | null => pending

/** Create the organization's profile with its own PIN, and show it. */
export const createOrganizationProfile = async (pin: string): Promise<Organization> => {
  if (!pending) throw new OrganizationError('ERROR_SIGNED_OUT')
  const salt = newPinSalt()
  const next: StoredProfile = {
    ...pending,
    pin: { salt, iterations: PIN_ITERATIONS, hash: hashOrganizationPin(pin, salt, PIN_ITERATIONS) },
    logs: [],
  }
  await writeOrganizationProfile(next)
  profile = next
  pending = null
  await setActiveProfile('organization')
  return visibleOrganization(next)
}

/**
 * Keep what the back-office said at sign-in on the device (D23): the
 * organization's name and its accreditation, so the profile shows them while
 * the app is offline or locked. Only for the profile's own account.
 */
const refreshProfile = async (organization: Organization): Promise<void> => {
  if (!profile || profile.username !== organization.username) return
  const next: StoredProfile = {
    ...profile,
    organization: organization.organization,
    accreditedUntil: organization.accreditedUntil,
    accreditationEnded: organization.accreditationEnded,
    revoked: organization.revoked ?? profile.revoked ?? null,
  }
  await writeOrganizationProfile(next)
  profile = next
}

/**
 * The organization's accreditation was revoked (D24). Kept on the profile, so
 * it no longer unlocks on this device; the session ends, and whatever screen
 * of it is open is told to lock (navigation/wrappers/LockAppWrapper.tsx).
 */
const revocationListeners = new Set<(revocation: Revocation) => void>()

/** Be told when the back-office says the organization was revoked; returns the way to stop. */
export const onRevoked = (listener: (revocation: Revocation) => void): (() => void) => {
  revocationListeners.add(listener)
  return () => {
    revocationListeners.delete(listener)
  }
}

const markRevoked = async (revocation: Revocation, username?: string): Promise<void> => {
  OrgSession.clear()
  // Only the profile on this device: a refusal while creating one for another
  // account locks nothing.
  if (!profile || (username && profile.username !== username)) return
  const next: StoredProfile = { ...profile, revoked: revocation, accreditationEnded: true }
  profile = next
  // Locked at once; the device keeps it as soon as the keychain has written.
  revocationListeners.forEach((listener) => listener(revocation))
  await writeOrganizationProfile(next).catch(() => {})
}

/** The refusal a revocation is told with (D24): its date, and whether it was the TAO's. */
const revokedError = (revocation: Revocation): OrganizationError =>
  new OrganizationError('ERROR_ACCREDITATION_REVOKED', { until: revocation.at, byTao: revocation.byTao })

/** The revocation a refusal or a profile names (D24), if it does. */
const revocationIn = revocationFromResponse

/** Whether `pin` unlocks the organization's profile. */
export const checkOrganizationPin = (pin: string): boolean => {
  if (!profile || !pin) return false
  const candidate = hashOrganizationPin(pin, profile.pin.salt, profile.pin.iterations)
  const expected = profile.pin.hash
  // In constant time, as a password check should be.
  return equalPinHashes(candidate, expected)
}

/**
 * Delete the organization's profile from this device: its PIN and history.
 * The back-office account stays, and so does the holder's wallet.
 */
export const deleteOrganizationProfile = async (): Promise<void> => {
  await deleteOrganizationProfileEntry()
  profile = null
  pending = null
  OrgSession.clear()
  if (active === 'organization') await setActiveProfile('holder')
}

/** Put an entry into the organization's own history (screens/Historical). */
export const addOrganizationLog = async (entry: ActionLog): Promise<void> => {
  if (!profile) return
  const next = { ...profile, logs: [...(profile.logs ?? []), entry].slice(-MAX_LOGS) }
  await writeOrganizationProfile(next)
  profile = next
}

/** The organization's history, newest first. */
export const organizationLogs = (): ActionLog[] => [...(profile?.logs ?? [])].reverse()

let session: { token: string; expiresAt: number } | null = null

export const OrgSession = {
  set(token: string): void {
    const expiresAt = Number(decodeJwt(token).exp ?? 0) * 1000
    session = { token, expiresAt }
  },
  /** The back-office token while it has at least half a minute left. */
  token(): string | null {
    return session && session.expiresAt - 30_000 > Date.now() ? session.token : null
  },
  clear(): void {
    session = null
  },
}

/** What a refusal names: password rules broken, fields wrong, attributes missing, an accreditation's end. */
type Details = {
  codes?: string[]
  fields?: string[]
  missing?: string[]
  invalid?: string[]
  until?: string | null
  byTao?: boolean
}

/** A refusal the holder can act on; `key` is in the Organization bundle. */
export class OrganizationError extends Error {
  codes: string[]
  fields: string[]
  missing: string[]
  invalid: string[]
  until: string | null
  /** For a revocation (D24): whether it was the TAO's, which took the TI's with it. */
  byTao: boolean

  constructor(
    public key: string,
    details: Details = {},
  ) {
    super(key)
    this.name = 'OrganizationError'
    this.codes = details.codes ?? []
    this.fields = details.fields ?? []
    this.missing = details.missing ?? []
    this.invalid = details.invalid ?? []
    this.until = details.until ?? null
    this.byTao = details.byTao ?? false
  }
}

// By name: instanceof is unreliable on a transpiled subclass of Error.
export const isOrganizationError = (error: unknown): error is OrganizationError =>
  (error as any)?.name === 'OrganizationError'

/** The session's token, or the refusal that sends the organization to sign in again. */
const sessionToken = (): string => {
  const token = OrgSession.token()
  if (!token) throw new OrganizationError('ERROR_SIGNED_OUT')
  return token
}

/**
 * The back-office no longer takes the token: the session is over. The same for
 * every call made with it; anything else is left to the caller.
 */
const endSessionOn401 = (error: any): void => {
  // Revoked since the sign-in (D24): signed out for good, and told why.
  const revocation = revocationIn(error?.response?.data)
  if (revocation) {
    void markRevoked(revocation)
    throw revokedError(revocation)
  }
  if (error?.response?.data?.code === 'token_not_valid' || error?.response?.status === 401) {
    OrgSession.clear()
    throw new OrganizationError('ERROR_SIGNED_OUT')
  }
}

/** A refusal the back-office names by `reason`, as the Organization bundle's key. */
const refusal = (data: any, keys: Record<string, string>): void => {
  const key = keys[data?.reason]
  if (key) throw new OrganizationError(key)
}

/** Sign in with the organization's back-office account; it must be allowed to issue. */
export const signIn = async (username: string, password: string): Promise<Organization> => {
  let access: string
  try {
    const data = await authenticateOrganization(username, password)
    access = data.access
  } catch (error: any) {
    // Revoked (D24): the back-office says so only to the right password.
    const revocation = revocationIn(error?.response?.data)
    if (revocation) {
      await markRevoked(revocation, username)
      throw revokedError(revocation)
    }
    // Wrong credentials and a deactivated account look the same: neither
    // may sign in, and telling them apart would confirm the username.
    if (error?.response?.status === 401) throw new OrganizationError('ERROR_CREDENTIALS')
    throw error
  }
  const me = await fetchOrganizationAccount(access)
  if (!(me?.roles ?? []).includes(ISSUER_ROLE)) throw new OrganizationError('ERROR_NOT_ISSUER')
  OrgSession.set(access)
  const name = me?.username ?? username
  const organization: Organization = {
    username: name,
    organization: me?.organization || name,
    // A back-office from before D23 says nothing: unknown, not unlimited.
    ...('accredited_until' in (me ?? {})
      ? { accreditedUntil: me.accredited_until ?? null, accreditationEnded: Boolean(me.accreditation_ended) }
      : {}),
    revoked: revocationIn(me),
  }
  await refreshProfile(organization).catch(() => {})
  return organization
}

/**
 * Ask the back-office whether the signed-in organization still stands (D24),
 * while its tabs are open. Nothing to ask without a session, and an
 * unreachable back-office is left for the next time. A revocation signs it
 * out and locks its profile (``onRevoked``); this then throws
 * ``ERROR_ACCREDITATION_REVOKED``.
 */
export const checkStanding = async (): Promise<void> => {
  const token = OrgSession.token()
  if (!token) return
  try {
    const data = await fetchOrganizationAccount(token)
    const revocation = revocationIn(data)
    if (revocation) {
      await markRevoked(revocation, data?.username)
      throw revokedError(revocation)
    }
  } catch (error: any) {
    if (isOrganizationError(error)) throw error
    endSessionOn401(error)
  }
}

/**
 * Register a TI's account with the invitation its TAO gave it (design decisions
 * D15). Only an organization the trust chain selected can: there is no
 * applying unasked. The wallet registers TIs only - a TAO works in the console.
 */
export const register = async (invitation: string, username: string, password: string): Promise<void> => {
  try {
    await registerOrganizationAccount(invitation, username, password)
  } catch (error: any) {
    const data = error?.response?.data
    refusal(data, {
      InvalidInvitation: 'ERROR_INVALID_INVITATION',
      WrongKind: 'ERROR_WRONG_KIND',
      UsernameTaken: 'ERROR_USERNAME_TAKEN',
    })
    if (data?.reason === 'WeakPassword') throw new OrganizationError('ERROR_WEAK_PASSWORD', { codes: data.codes })
    if (data?.reason === 'InvalidFields') throw new OrganizationError('ERROR_INVALID_FIELDS', { fields: data.fields })
    if (error?.response?.status === 429) throw new OrganizationError('ERROR_TOO_MANY')
    throw error
  }
}

/** The schemas this TI may issue and what each must say (D16, D17); the form is built from them. */
export const certificateScheme = async (): Promise<Scheme> => {
  const token = sessionToken()
  try {
    const data = await fetchCertificateScheme(token)
    // A back-office from before D17 answers with one scheme's fields.
    const schemas: Schema[] = data.schemas ?? [
      { credential_type: data.credential_type, name: { sk: '', en: '' }, version: 1, fields: data.fields },
    ]
    return {
      schemas,
      organization: data.organization,
      ...('accredited_until' in data
        ? { accreditedUntil: data.accredited_until ?? null, accreditationEnded: Boolean(data.accreditation_ended) }
        : {}),
    }
  } catch (error: any) {
    endSessionOn401(error)
    throw error
  }
}

/** Issue a certificate of one schema: the registry returns an offer for the holder's wallet. */
export const issueCertificate = async (
  holderReference: string,
  claims: Record<string, unknown>,
  credentialType: string,
): Promise<Offer> => {
  const token = sessionToken()
  try {
    const data = await createCertificateOffer(token, holderReference, claims, credentialType)
    return {
      offerUri: data.offer_uri,
      qr: data.qr,
      pin: data.pin,
      expiresAt: data.offer_expires_at,
      credentialId: data.credential_id,
    }
  } catch (error: any) {
    const status = error?.response?.status
    const data = error?.response?.data
    endSessionOn401(error)
    if (data?.reason === 'InvalidClaims') {
      throw new OrganizationError('ERROR_INVALID_CLAIMS', { missing: data.missing, invalid: data.invalid })
    }
    // The TI's accreditation has ended (D23): it issues nothing more, and its
    // earlier certificates stay valid. Named here, so it is never read as an
    // expired offer or certificate.
    if (data?.reason === 'AccreditationExpired') {
      throw new OrganizationError('ERROR_ACCREDITATION_EXPIRED', { until: data.accredited_until ?? null })
    }
    refusal(data, {
      NotATI: 'ERROR_NOT_TI',
      SchemaNotAccredited: 'ERROR_SCHEMA_NOT_ACCREDITED',
      RoleRequired: 'ERROR_NOT_ISSUER',
      NotAccredited: 'ERROR_NOT_ACCREDITED',
      // The TI issues under its own DID, which is not set up in EBSI yet (D27).
      NotOnboarded: 'ERROR_NOT_ONBOARDED',
    })
    if (status === 400) throw new OrganizationError('ERROR_ISSUE_INVALID')
    throw error
  }
}
