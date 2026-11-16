// A TI's accreditation has an end (design decisions D23): what the organization's
// profile keeps of it, and how a refusal after it reaches the screen.

let mockKeychain: Record<string, string> = {}

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
    mockKeychain[service] ? { username: 'u', password: mockKeychain[service] } : false,
  ),
  setGenericPassword: jest.fn(async (_username: string, password: string, { service }: { service: string }) => {
    mockKeychain[service] = password
    return { service }
  }),
  resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
    delete mockKeychain[service]
    return true
  }),
}))
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }))
jest.mock('@infrastructure/config/Backoffice', () => ({
  TIMEOUT_MS: 1000,
  backofficeUrl: () => 'http://backoffice.test',
}))

import axios from 'axios'
import {
  ENDING_SOON_DAYS,
  OrgSession,
  accreditationState,
  certificateScheme,
  checkStanding,
  createOrganizationProfile,
  deleteOrganizationProfile,
  isOrganizationError,
  issueCertificate,
  onRevoked,
  organizationProfile,
  setPendingOrganization,
  signIn,
} from './OrganizationService'

const NOW = new Date('2026-10-13T12:00:00.000Z').getTime()
const DAY = 86_400_000
const token = (): string => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256' })}.${part({ exp: Math.floor(NOW / 1000) + 900 })}.signature`
}
const mocked = axios as unknown as { post: jest.Mock; get: jest.Mock }

describe('accreditationState', () => {
  it('reads an end the back-office never gave as unknown, and none as unlimited', () => {
    expect(accreditationState(undefined, undefined, NOW)).toEqual({ kind: 'unknown' })
    expect(accreditationState(null, false, NOW)).toEqual({ kind: 'unlimited' })
  })

  it('warns in the last days before the end', () => {
    const far = new Date(NOW + 90 * DAY).toISOString()
    const near = new Date(NOW + 10 * DAY).toISOString()
    expect(accreditationState(far, false, NOW)).toMatchObject({ kind: 'valid', days: 90 })
    expect(accreditationState(near, false, NOW)).toMatchObject({ kind: 'ending', days: 10 })
    expect(accreditationState(new Date(NOW + ENDING_SOON_DAYS * DAY).toISOString(), false, NOW).kind).toBe('ending')
  })

  it('ends when the back-office says so, or when the end has passed on the device', () => {
    const far = new Date(NOW + 90 * DAY).toISOString()
    const past = new Date(NOW - DAY).toISOString()
    expect(accreditationState(far, true, NOW)).toEqual({ kind: 'ended', until: far })
    expect(accreditationState(past, false, NOW)).toEqual({ kind: 'ended', until: past })
  })

  it('reads a revocation before anything else (D24)', () => {
    const far = new Date(NOW + 90 * DAY).toISOString()
    expect(accreditationState(far, false, NOW, { at: '2026-10-13', byTao: true })).toEqual({
      kind: 'revoked',
      at: '2026-10-13',
      byTao: true,
    })
  })
})

describe('the organization profile', () => {
  beforeEach(() => {
    mockKeychain = {}
    mocked.post.mockReset()
    mocked.get.mockReset()
    OrgSession.clear()
    jest.setSystemTime(NOW)
  })

  const signsIn = (me: Record<string, unknown>) => {
    mocked.post.mockResolvedValueOnce({ data: { access: token() } })
    mocked.get.mockResolvedValueOnce({
      data: { username: 'certorg', roles: ['plr_issuer'], organization: 'CertOrg', ...me },
    })
  }

  it('keeps the accreditation end the back-office gives at sign-in, and refreshes it', async () => {
    const until = new Date(NOW + 365 * DAY).toISOString()
    signsIn({ accredited_until: until, accreditation_ended: false })
    setPendingOrganization(await signIn('certorg', 'secret'))
    await createOrganizationProfile('135790')
    expect(organizationProfile()).toMatchObject({ accreditedUntil: until, accreditationEnded: false })

    // Its TAO ended it since: the next sign-in says so, and the profile keeps it.
    signsIn({ accredited_until: new Date(NOW).toISOString(), accreditation_ended: true })
    await signIn('certorg', 'secret')
    expect(organizationProfile()).toMatchObject({ accreditationEnded: true })
    expect(JSON.parse(mockKeychain['plr.organization']).accreditationEnded).toBe(true)
  })

  it('knows nothing of an end from a back-office that does not say', async () => {
    signsIn({})
    const organization = await signIn('certorg', 'secret')
    expect(organization.accreditedUntil).toBeUndefined()
  })

  it('turns a refusal after the end into its own error, with the date', async () => {
    signsIn({})
    await signIn('certorg', 'secret')
    const until = '2026-10-01T21:59:59+00:00'
    mocked.post.mockRejectedValueOnce({
      response: { status: 403, data: { reason: 'AccreditationExpired', accredited_until: until } },
    })
    const refused = await issueCertificate('spis-1', { holderName: 'X' }, 'CybersecurityManagerCertificate').catch(
      (e) => e,
    )
    expect(isOrganizationError(refused)).toBe(true)
    expect(refused.key).toBe('ERROR_ACCREDITATION_EXPIRED')
    expect(refused.until).toBe(until)
  })
})

describe('a revoked organization (D24)', () => {
  const REVOKED = {
    detail: 'The accreditation of CertOrg was revoked on 2026-10-13.',
    reason: 'AccreditationRevoked',
    revoked_at: '2026-10-13',
    revoked_organization_kind: 'ti',
  }
  let locked: unknown[]
  let stop: () => void

  beforeEach(async () => {
    mockKeychain = {}
    mocked.post.mockReset()
    mocked.get.mockReset()
    OrgSession.clear()
    jest.setSystemTime(NOW)
    await deleteOrganizationProfile()
    // The profile on this device, signed in.
    mocked.post.mockResolvedValueOnce({ data: { access: token() } })
    mocked.get.mockResolvedValueOnce({ data: { username: 'certorg', roles: ['plr_issuer'], organization: 'CertOrg' } })
    setPendingOrganization(await signIn('certorg', 'secret'))
    await createOrganizationProfile('135790')
    locked = []
    stop = onRevoked((revocation) => locked.push(revocation))
  })
  afterEach(() => stop())

  it('is refused at sign-in, with the date, and its profile no longer opens', async () => {
    mocked.post.mockRejectedValueOnce({
      response: { status: 401, data: { ...REVOKED, revoked_organization_kind: 'tao' } },
    })
    const refused = await signIn('certorg', 'secret').catch((e) => e)
    expect(refused.key).toBe('ERROR_ACCREDITATION_REVOKED')
    expect(refused.byTao).toBe(true)
    expect(refused.until).toBe('2026-10-13')
    expect(organizationProfile()?.revoked).toEqual({ at: '2026-10-13', byTao: true })
    expect(JSON.parse(mockKeychain['plr.organization']).revoked).toEqual({ at: '2026-10-13', byTao: true })
    expect(locked).toHaveLength(1)
  })

  it('is signed out when a call made while signed in is refused', async () => {
    mocked.get.mockRejectedValueOnce({ response: { status: 401, data: REVOKED } })
    const refused = await certificateScheme().catch((e) => e)
    expect(refused.key).toBe('ERROR_ACCREDITATION_REVOKED')
    expect(OrgSession.token()).toBeNull()
    expect(organizationProfile()?.revoked).toEqual({ at: '2026-10-13', byTao: false })
    expect(locked).toHaveLength(1)
  })

  it('finds out by itself while signed in, and asks nothing once signed out', async () => {
    mocked.get.mockRejectedValueOnce({ response: { status: 401, data: REVOKED } })
    await expect(checkStanding()).rejects.toMatchObject({ key: 'ERROR_ACCREDITATION_REVOKED' })
    expect(locked).toHaveLength(1)
    mocked.get.mockClear()
    await checkStanding()
    expect(mocked.get).not.toHaveBeenCalled()
  })

  it('locks nothing for another account refused while creating a profile', async () => {
    mocked.post.mockRejectedValueOnce({ response: { status: 401, data: REVOKED } })
    const refused = await signIn('someone-else', 'secret').catch((e) => e)
    expect(refused.key).toBe('ERROR_ACCREDITATION_REVOKED')
    expect(organizationProfile()?.revoked).toBeNull()
    expect(locked).toHaveLength(0)
  })
})
