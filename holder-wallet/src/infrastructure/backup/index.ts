// The wallet's encrypted backup in the back-office (design decisions D31).
// After every change the wallet seals its certificates, its sharing history
// and its log (envelope.ts) and uploads them under an address derived from
// the identity key (keys.ts). Restoring the recovery phrase on a new phone
// derives the same keys, downloads the backup and opens it there. The
// back-office keeps a ciphertext and a public key, and never the DID.
// A wallet only uploads once it holds everything it should: a new one at once,
// a restored one after its backup came back. A restore fetches the backup
// before it installs anything, so with the back-office out of reach it stops
// there (BackupUnavailable) and the phone keeps the wallet it had. One cut
// short after installing - the app closed - fetches it at the next sign-in,
// and until then nothing is uploaded: an empty wallet must never overwrite
// the backup it is waiting for.
import axios from 'axios'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { backofficeUrl, isBackofficeConfigured } from '@infrastructure/config/Backoffice'
import { getKeychainDataObject, getPrivateKey, setKeychainDataObject } from '@infrastructure/persistence/keychain'
import { KeyChainData } from '@infrastructure/persistence/keychain/keychain.types'
import { backupKeys, BackupKeys } from './keys'
import { digest, open, proof, seal } from './envelope'
import { onWalletChanged } from './changes'

const FORMAT = 'plr-wallet-backup'

/**
 * How long an upload or a download of the backup may take. The backup grows
 * with the wallet - a holder with a thousand certificates has megabytes of
 * it - and on a slow connection that takes minutes, not the half-minute an
 * ordinary request to the back-office is given.
 */
const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000

/** Where the backup stands on this phone. */
const STATE_KEY = 'backupState'
const VERSION_KEY = 'backupVersion'
type BackupState = 'ready' | 'restoring'

/** Changes are gathered for this long before one upload carries them all. */
const DEBOUNCE_MS = 3000

export type BackupContent = {
  format: typeof FORMAT
  savedAt: string
  credentials: NonNullable<KeyChainData['credentials']>
  presentations: NonNullable<KeyChainData['presentations']>
  deferredCredentials: NonNullable<KeyChainData['deferred_credentials']>
  actionLogs: NonNullable<KeyChainData['actionLogs']>
}

const urlOf = (keys: BackupKeys) => `${backofficeUrl()}/wallet-backups/${keys.backupId}/`

const contentOf = (wallet: KeyChainData): BackupContent => ({
  format: FORMAT,
  savedAt: new Date().toISOString(),
  credentials: wallet.credentials ?? [],
  presentations: wallet.presentations ?? [],
  deferredCredentials: wallet.deferred_credentials ?? [],
  actionLogs: wallet.actionLogs ?? [],
})

const stateOf = async (): Promise<BackupState | ''> =>
  (await LocalStorageService.getData(STATE_KEY)) as BackupState | ''

/** Uploads go ahead: a wallet made before backups existed counts as ready. */
const isReady = async (): Promise<boolean> => {
  const state = await stateOf()
  if (state) return state === 'ready'
  return LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED)
}

export const markBackupReady = (): Promise<void> => LocalStorageService.storeData(STATE_KEY, 'ready')

/** Before a restored identity is installed: nothing is uploaded until its backup is back. */
export const markRestoring = (): Promise<void> => LocalStorageService.storeData(STATE_KEY, 'restoring')

export const isRestorePending = async (): Promise<boolean> => (await stateOf()) === 'restoring'

const lastVersion = async (): Promise<number> => Number(await LocalStorageService.getData(VERSION_KEY)) || 0

const keysNow = async (): Promise<BackupKeys | null> => {
  // The identity key needs the PIN of this session; a locked wallet uploads later.
  const privateKey = await getPrivateKey().catch(() => null)
  return privateKey ? backupKeys(privateKey) : null
}

export type UploadResult = 'uploaded' | 'not-ready' | 'locked' | 'unconfigured'

/** Seal the wallet as it is now and upload it. */
export const uploadBackup = async (): Promise<UploadResult> => {
  if (!isBackofficeConfigured()) return 'unconfigured'
  if (!(await isReady())) return 'not-ready'
  const keys = await keysNow()
  const wallet = await getKeychainDataObject()
  if (!keys || !wallet) return 'locked'
  const ciphertext = seal(keys, JSON.stringify(contentOf(wallet)))
  const send = (version: number) =>
    axios.put(
      urlOf(keys),
      { ciphertext, version, proof: proof(keys, { version, digest: digest(ciphertext) }) },
      { timeout: TRANSFER_TIMEOUT_MS },
    )
  // Milliseconds, so a later upload has a higher version on any phone.
  let version = Math.max(Date.now(), (await lastVersion()) + 1)
  try {
    await send(version)
  } catch (error: any) {
    const kept = error?.response?.data?.reason === 'StaleVersion' ? Number(error.response.data.version) : 0
    if (!kept) throw error
    // Another phone with the same phrase uploaded since; this one is newer.
    version = kept + 1
    await send(version)
  }
  await LocalStorageService.storeData(VERSION_KEY, String(version))
  return 'uploaded'
}

/**
 * The back-office could not be asked for the backup - down, unreachable from
 * this phone, or refusing for now. Whether there is a backup is not known.
 */
export class BackupUnavailable extends Error {}

export type DownloadedBackup = { content: BackupContent; version: number }

/** The backup in the back-office, opened; null when there is none. Throws BackupUnavailable. */
export const downloadBackup = async (keys: BackupKeys): Promise<DownloadedBackup | null> => {
  let data: any
  try {
    data = (await axios.get(urlOf(keys), { timeout: TRANSFER_TIMEOUT_MS })).data
  } catch (error: any) {
    if (error?.response?.status === 404) return null
    throw new BackupUnavailable(String(error?.message ?? error))
  }
  const content = JSON.parse(open(keys, String(data?.ciphertext ?? ''))) as BackupContent
  if (content?.format !== FORMAT) throw new Error('Not a wallet backup')
  return { content, version: Number(data.version) || 0 }
}

const unionBy = <T>(remote: T[], local: T[], key: (item: T) => string): T[] => {
  const kept = new Map<string, T>()
  for (const item of [...remote, ...local]) kept.set(key(item), item)
  return [...kept.values()]
}

export type RestoreResult = { found: boolean; credentials: number }

/**
 * Bring a downloaded backup into this wallet. What the wallet holds already
 * stays: a certificate collected while the backup could not be reached is not
 * lost. Returns how many certificates the wallet holds then.
 */
export const mergeBackup = async ({ content, version }: DownloadedBackup): Promise<number> => {
  const wallet = await getKeychainDataObject()
  if (!wallet) throw new Error('The wallet is locked')
  wallet.credentials = unionBy(content.credentials ?? [], wallet.credentials ?? [], (c: any) => String(c.id))
  wallet.presentations = unionBy(content.presentations ?? [], wallet.presentations ?? [], (p: any) => String(p.id))
  wallet.deferred_credentials = unionBy(
    content.deferredCredentials ?? [],
    wallet.deferred_credentials ?? [],
    // OpenID4VCI 1.0 names a deferral by its transaction id; older backups by an acceptance token.
    (d: any) => String(d.transaction_id ?? d.acceptance_token),
  )
  wallet.actionLogs = unionBy(
    content.actionLogs ?? [],
    wallet.actionLogs ?? [],
    (log: any) => `${log.id}|${log.actionType}|${new Date(log.date).toISOString()}`,
  )
  await setKeychainDataObject(wallet)
  await LocalStorageService.storeData(VERSION_KEY, String(version))
  return wallet.credentials?.length ?? 0
}

/** Download the backup of the wallet on this phone and bring it in (a restore interrupted before it got it). */
export const restoreBackup = async (): Promise<RestoreResult> => {
  const keys = await keysNow()
  const wallet = await getKeychainDataObject()
  if (!keys || !wallet) throw new Error('The wallet is locked')
  const found = await downloadBackup(keys)
  const credentials = found ? await mergeBackup(found) : (wallet.credentials?.length ?? 0)
  await markBackupReady()
  return { found: Boolean(found), credentials }
}

let timer: ReturnType<typeof setTimeout> | null = null
let started = false

/** Upload a little after the last change; a failure is tried again with the next. */
export const scheduleBackup = (): void => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    uploadBackup().catch((error) => console.warn('[wallet] backup not uploaded:', error?.message ?? error))
  }, DEBOUNCE_MS)
}

/** Listen for the wallet's changes; once, at start. */
export const startBackups = (): void => {
  if (started) return
  started = true
  onWalletChanged(scheduleBackup)
}

/**
 * After sign-in: finish a restore still waiting for its backup, then upload
 * what changed while the wallet was locked.
 */
export const resumeBackups = async (): Promise<void> => {
  if (!isBackofficeConfigured()) return
  try {
    if (await isRestorePending()) await restoreBackup()
    scheduleBackup()
  } catch (error: any) {
    console.warn('[wallet] backup not resumed:', error?.message ?? error)
  }
}
