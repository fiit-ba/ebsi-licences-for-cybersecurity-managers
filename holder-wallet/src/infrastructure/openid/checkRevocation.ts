// A registry certificate's standing from its record on the governance contract alone (design decisions D36), suspension as its own state, and an offline phone no longer revoking a licence (project documentation, What changed).
import 'react-native-get-random-values'
import '@ethersproject/shims'
import { ethers } from 'ethers'
import { getEthAddressFromExtenderPublicKey } from '@infrastructure/crypto/legacyCrypto'
import { CREDENTIALS_CONTRACT_ADDRESS, STATUS_LIST_2021 } from '@infrastructure/identity/alastria/constants'
import { credentialsAbi } from '@infrastructure/identity/alastria/contracts/credentialsAbi'
import { decodeJwt } from 'jose'
import { decodeToken } from 'jsontokens'
import { getTrustedFrameworkFromDid } from './utils'
// The status entry and result types of the rewritten checks below.
import { CredentialStatusEntry, CredentialStatusResult, Vc } from './types'
import { descompressGZIP, getBitFromBitString } from '@shared/utils/utils'
// The held credentials and where their status is recorded
// (refreshStoredStatuses, below).
import { getCredentialsList, markItemStatus } from '@infrastructure/persistence/keychain'
// A certificate's standing on the certificate registry (design decisions D30, D34, D36).
import {
  ledgerEntryOf,
  readCertificateStatus,
  recordDiffers,
  statusKeyOfCredential,
  TIMEOUT_MS as LEDGER_TIMEOUT_MS,
} from '@infrastructure/ledger'
import { certificates } from '@infrastructure/config/Ebsi'

const CLOCK_TOLERANCE_SECONDS = 5
const STATUS_REFRESH_CONCURRENCY = 6
// How long one certificate's status may take: longer than the read of its
// record, so a slow connection gets its answer rather than none.
const STATUS_TIMEOUT_MS = LEDGER_TIMEOUT_MS + 5000

type StatusListResponse = { status: number; body: string } | { error: string }

type StatusListResponseCache = Map<string, Promise<StatusListResponse>>

export const checkRevocationStatus = async (
  token: string,
  signal?: AbortSignal,
  statusListCache?: StatusListResponseCache,
) => {
  // The signed part: a registry certificate keeps its disclosures after it (D36).
  const decodedCredential = decodeJwt(String(token).split('~')[0])
  const vc = decodedCredential.vc as Vc
  const issuer = vc.issuer

  let trustedFramework = getTrustedFrameworkFromDid(issuer)

  if (trustedFramework === 'epic') {
    const provider = new ethers.providers.JsonRpcProvider(process.env.NODE_IP)
    const contractAddress = CREDENTIALS_CONTRACT_ADDRESS
    const contractABI = credentialsAbi

    const ownerAddress = getEthAddressFromExtenderPublicKey(decodedCredential.iss)

    const contract = new ethers.Contract(contractAddress, contractABI, provider)

    try {
      const credentialHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(token))

      if (!credentialHash || !ownerAddress) return
      const status = await contract.getObjectStatus(credentialHash, ownerAddress)

      return status
    } catch (error) {
      console.error('Error checking credential status: ', error)
    }
  } else if (trustedFramework === 'ebsi') {
    // The certificate registry's record, for a registry certificate (D30, D36).
    const status = await checkCertificateStatus(decodedCredential.vc, signal, statusListCache, token)

    return status
  } else {
    // A key the display layer shows in Slovak.
    throw new Error('ERROR_UNKNOWN_FRAMEWORK')
  }
}
/**
 * A registry certificate's standing (D30, D36): the certificate registry's
 * record - the only source of truth about it - read through EBSI's Ledger
 * API, which needs no back-office. Only the registry this wallet was built to
 * trust counts: a certificate is handed over by its holder, and with it
 * whatever contract it names. The record is found by the certificate's TI and
 * id, and must be the certificate's own - the hash of this very credential and
 * its dates. When the ledger cannot be read, the certificate names another
 * registry, or its record is still being written after collection, the
 * standing is unknown: there is nothing to fall back on.
 * @param credential - The credential itself (its JWT, disclosures may follow), whose hash the record keeps.
 */
export async function checkCertificateStatus(
  vc: any,
  signal?: AbortSignal,
  statusListCache?: StatusListResponseCache,
  credential?: string,
): Promise<CredentialStatusResult> {
  const ledger = ledgerEntryOf(vc)
  if (!ledger) return checkCredentialStatus(vc, signal, statusListCache)
  if (!certificates.registry() || ledger.contract.toLowerCase() !== certificates.registry()) {
    return { valid: false, state: 'unknown', error: 'The certificate names another certificate registry' }
  }
  const statusKey = statusKeyOfCredential(vc)
  if (!statusKey || !credential) return { valid: false, state: 'unknown', error: 'The certificate has no record key' }
  try {
    const record = await readCertificateStatus(statusKey, signal)
    if (record.standing === 'none') return { valid: false, state: 'unknown', error: 'Not recorded yet' }
    const differs = recordDiffers(record, vc, credential)
    if (differs.length) {
      return {
        valid: false,
        state: 'unknown',
        error: `The record is not the certificate's own (${differs.join(', ')})`,
      }
    }
    if (record.standing === 'revoked') return { valid: false, state: 'revoked' }
    if (record.standing === 'suspended') return { valid: false, state: 'suspended' }
    return { valid: true, state: 'valid' }
  } catch (error) {
    return { valid: false, state: 'unknown', error: (error as Error)?.message ?? 'The ledger could not be read' }
  }
}
// Rewritten: every entry is checked and the most severe outcome reported,
// with suspension apart from revocation (upstream stopped at the first
// failing entry and knew only "not valid").
/**
 * Evaluate every `credentialStatus` entry on a credential.
 *
 * A certificate subject to both suspension and revocation carries two entries
 * (component 2.2), so all of them are checked and the most severe outcome is
 * reported. Revocation outranks suspension because it is terminal.
 *
 * The wallet is not the trust anchor — the Verifier Service decides whether a
 * presented credential is acceptable (component 6). What the wallet owes the
 * holder is an honest picture of their own credential, which means telling
 * suspension and revocation apart rather than collapsing both into "revoked".
 */
export async function checkCredentialStatus(
  vc: any,
  signal?: AbortSignal,
  statusListCache?: StatusListResponseCache,
): Promise<CredentialStatusResult> {
  if (!vc?.credentialStatus) {
    return { valid: true, state: 'valid' }
  }

  const entries: CredentialStatusEntry[] = Array.isArray(vc.credentialStatus)
    ? vc.credentialStatus
    : [vc.credentialStatus]

  const results: CredentialStatusResult[] = []
  for (const entry of entries) {
    results.push(await checkSingleCredentialStatus(entry, vc.issuer, signal, statusListCache))
  }

  // Most severe first, so a readable list saying "valid" cannot mask an
  // unreadable one.
  for (const state of ['revoked', 'suspended', 'unknown'] as const) {
    const hit = results.find((result) => result.state === state)
    if (hit) {
      return hit
    }
  }

  return { valid: true, state: 'valid' }
}
// Rewritten: an entry that cannot be evaluated reported as unknown.
async function checkSingleCredentialStatus(
  status: CredentialStatusEntry,
  issuer: string,
  signal?: AbortSignal,
  statusListCache?: StatusListResponseCache,
): Promise<CredentialStatusResult> {
  if (status.type !== STATUS_LIST_2021) {
    // An entry we cannot evaluate is not an entry we may ignore - a
    // Bitstring entry of a certificate from before D36 among them. The
    // guard exhausts the union, so `status` narrows to `never` here; the
    // cast is only so the message can name the type that arrived at
    // runtime, which is exactly the case this branch exists for.
    const unsupported = (status as CredentialStatusEntry).type
    return {
      valid: false,
      state: 'unknown',
      error: `Unsupported credential status type '${unsupported}'`,
    }
  }
  return await checkStatusList(status, issuer, signal, statusListCache)
}

const fetchStatusList = async (url: string, signal?: AbortSignal): Promise<StatusListResponse> => {
  try {
    const response = await fetch(url, {
      // The list URI is stable while its signed contents change. Ask the
      // device and intermediary caches to revalidate so opening the wallet
      // does not keep showing an older suspension or reinstatement.
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal,
    })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

const cachedStatusList = (
  url: string,
  signal?: AbortSignal,
  cache?: StatusListResponseCache,
): Promise<StatusListResponse> => {
  if (!cache) return fetchStatusList(url, signal)

  const existing = cache.get(url)
  if (existing) return existing

  const request = fetchStatusList(url, signal)
  cache.set(url, request)
  return request
}
// Rewritten: an unreadable list is "unknown", never "revoked"; the list's
// issuer, purpose, validity window and index range are checked; and
// suspension is told apart from revocation.
async function checkStatusList(
  credentialStatus: CredentialStatusEntry,
  issuer: string,
  signal?: AbortSignal,
  statusListCache?: StatusListResponseCache,
): Promise<CredentialStatusResult> {
  const purpose = credentialStatus.statusPurpose
  if (purpose !== 'revocation' && purpose !== 'suspension') {
    return {
      valid: false,
      state: 'unknown',
      error: `Unsupported status purpose '${purpose}'`,
    }
  }

  if (!credentialStatus.statusListCredential) {
    return {
      valid: false,
      state: 'unknown',
      error: 'Status entry is missing statusListCredential',
    }
  }

  const response = await cachedStatusList(credentialStatus.statusListCredential, signal, statusListCache)
  if ('error' in response) {
    return { valid: false, state: 'unknown', error: response.error }
  }
  if (response.status !== 200) {
    // A phone is offline often enough that this must not read as "revoked".
    return {
      valid: false,
      state: 'unknown',
      error: `Status list fetch returned HTTP ${response.status}`,
    }
  }
  const body = response.body

  // Should be in JWT format - we are receiving plain text
  // Some compatible endpoints JSON-encode the plain JWT despite a text response.
  // The endpoint serves a JWT as plain text; strip the quotes a JSON-encoding
  // upstream may have added.
  const statusVc = body.trim().replace(/^"|"$/g, '')

  let payload: any
  try {
    payload = (decodeToken(statusVc) as any)?.payload
  } catch (error) {
    return {
      valid: false,
      state: 'unknown',
      error: `Status list credential could not be decoded: ${(error as Error).message}`,
    }
  }

  const statusVcBody = payload?.vc
  if (!statusVcBody) {
    return { valid: false, state: 'unknown', error: 'Status list credential has no VC payload' }
  }

  // The credential and its status list must share an issuer, or the list says
  // nothing about this credential.
  if (statusVcBody.issuer !== issuer) {
    return {
      valid: false,
      state: 'unknown',
      error: 'Status list issuer does not match the credential issuer',
    }
  }

  const temporal = checkTemporalValidity(statusVcBody)
  if (temporal) {
    return temporal
  }

  const subject = statusVcBody.credentialSubject ?? {}
  if (subject.statusPurpose && subject.statusPurpose !== purpose) {
    return {
      valid: false,
      state: 'unknown',
      error: `Status list declares purpose '${subject.statusPurpose}', expected '${purpose}'`,
    }
  }
  if (!subject.encodedList) {
    return { valid: false, state: 'unknown', error: 'Status list carries no encodedList' }
  }

  let bitstring: Buffer
  try {
    bitstring = await descompressGZIP(Buffer.from(subject.encodedList, 'base64'))
  } catch (error) {
    return {
      valid: false,
      state: 'unknown',
      error: `Status list could not be decoded: ${(error as Error).message}`,
    }
  }

  const index = parseInt(credentialStatus.statusListIndex, 10)
  if (!Number.isInteger(index) || index < 0 || index >= bitstring.length * 8) {
    return {
      valid: false,
      state: 'unknown',
      error: 'statusListIndex is out of range for the published list',
    }
  }

  if (getBitFromBitString(bitstring, index) === 1) {
    // The distinction the holder cares about: suspension can be lifted,
    // revocation cannot (component 1.1).
    return purpose === 'revocation' ? { valid: false, state: 'revoked' } : { valid: false, state: 'suspended' }
  }

  return { valid: true, state: 'valid' }
}
// Added: the status list's own validity window.
/** An expired or not-yet-valid status list tells us nothing; it is not a pass. */
function checkTemporalValidity(statusVc: any): CredentialStatusResult | undefined {
  const now = Math.floor(Date.now() / 1000)

  const validFromRaw = statusVc.validFrom ?? statusVc.issuanceDate
  if (validFromRaw) {
    const validFrom = Math.floor(Date.parse(validFromRaw) / 1000)
    if (!Number.isNaN(validFrom) && validFrom > now + CLOCK_TOLERANCE_SECONDS) {
      return { valid: false, state: 'unknown', error: 'Status list is not yet valid' }
    }
  }

  const validUntilRaw = statusVc.validUntil ?? statusVc.expirationDate
  if (validUntilRaw) {
    const validUntil = Math.floor(Date.parse(validUntilRaw) / 1000)
    if (!Number.isNaN(validUntil) && validUntil <= now) {
      return { valid: false, state: 'unknown', error: 'Status list is expired' }
    }
  }

  return undefined
}
// The current status of a held credential, as the wallet stores
// it - or undefined when it could not be established (offline, list
// unavailable). Undefined is not evidence of anything and must not be stored
// (see "An offline phone no longer revokes a licence", project documentation).
export const currentStoredStatus = async (
  token: string,
  timeoutMs = STATUS_TIMEOUT_MS,
  statusListCache?: StatusListResponseCache,
): Promise<'Active' | 'Suspended' | 'Revoked' | undefined> => {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result: any = await Promise.race([
      checkRevocationStatus(token, controller.signal, statusListCache),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, timeoutMs)
      }),
    ])
    if (result === 'Revoked' || result?.state === 'revoked') return 'Revoked'
    if (result?.state === 'suspended') return 'Suspended'
    if (result?.state === 'valid') return 'Active'
    return undefined
  } catch {
    return undefined
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
// Re-checks every held credential that is not revoked, and records what it
// finds, so the list shows a suspension - or its end - without the holder
// opening each certificate ("Update certificates"). Checks use bounded
// concurrency and share identical status-list downloads within one pass; the
// writes stay sequential because each rewrites the whole keychain entry and
// two at once would lose one of them.
export type RefreshStoredStatusesOptions = {
  /** Run one more pass after an existing automatic refresh finishes. */
  forceAfterCurrent?: boolean
}

/**
 * What one pass found out: how many held certificates it checked, and of those
 * how many it could not read (registry or ledger unreachable, too slow, or no
 * record yet). Those keep their last known status, so "Update certificates"
 * must not claim the list is current.
 */
export type StoredStatusRefresh = { checked: number; unchecked: number }

let statusRefreshInFlight: Promise<StoredStatusRefresh> | null = null

const performStoredStatusRefresh = async (): Promise<StoredStatusRefresh> => {
  const held: { token: string; timestamp: Date }[] = []
  for (const item of await getCredentialsList()) {
    const token: unknown = item.credential
    if (item.status !== 'Revoked' && typeof token === 'string' && item.timestamp) {
      held.push({ token, timestamp: item.timestamp })
    }
  }
  const statusListCache: StatusListResponseCache = new Map()
  const statuses: Array<'Active' | 'Suspended' | 'Revoked' | undefined> = new Array(held.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < held.length) {
      const index = nextIndex++
      statuses[index] = await currentStoredStatus(held[index].token, STATUS_TIMEOUT_MS, statusListCache)
    }
  }
  await Promise.all(Array.from({ length: Math.min(STATUS_REFRESH_CONCURRENCY, held.length) }, () => worker()))
  let unchecked = 0
  for (let index = 0; index < held.length; index++) {
    const status = statuses[index]
    if (status) await markItemStatus(held[index].timestamp, 'credential', status)
    else unchecked++
  }
  return { checked: held.length, unchecked }
}

export const refreshStoredStatuses = (options: RefreshStoredStatusesOptions = {}): Promise<StoredStatusRefresh> => {
  if (statusRefreshInFlight) {
    const current = statusRefreshInFlight
    return options.forceAfterCurrent
      ? current.then(
          () => refreshStoredStatuses(),
          () => refreshStoredStatuses(),
        )
      : current
  }

  const refresh = performStoredStatusRefresh()
  const wrappedRefresh = refresh.finally(() => {
    if (statusRefreshInFlight === wrappedRefresh) statusRefreshInFlight = null
  })
  statusRefreshInFlight = wrappedRefresh
  return wrappedRefresh
}
