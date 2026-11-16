// Uploading and restoring the backup (design decisions D31). Above all: a wallet
// waiting for its backup never uploads over it.
import axios from 'axios'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { backupKeys } from './keys'
import { open, seal } from './envelope'

const mockIdentity = '0x' + '4c'.repeat(32)
let mockWallet: any

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }))
jest.mock('@infrastructure/config/Backoffice', () => ({
  backofficeUrl: () => 'http://backoffice.test',
  isBackofficeConfigured: () => true,
  TIMEOUT_MS: 1000,
}))
jest.mock('@infrastructure/persistence/keychain', () => ({
  getPrivateKey: jest.fn(async () => mockIdentity),
  getKeychainDataObject: jest.fn(async () => mockWallet),
  setKeychainDataObject: jest.fn(async (data: any) => {
    mockWallet = data
  }),
}))

import {
  BackupUnavailable,
  downloadBackup,
  markBackupReady,
  markRestoring,
  mergeBackup,
  restoreBackup,
  uploadBackup,
} from '.'

const keys = backupKeys(mockIdentity)
const url = `http://backoffice.test/wallet-backups/${keys.backupId}/`
const remote = (content: object, version = 5) => ({
  data: { version, ciphertext: seal(keys, JSON.stringify({ format: 'plr-wallet-backup', ...content })) },
})

beforeEach(async () => {
  jest.clearAllMocks()
  ;(AsyncStorage as any).clear()
  mockWallet = { credentials: [{ id: 'urn:uuid:local' }], presentations: [], actionLogs: [] }
  await AsyncStorage.setItem('isWalletCreated', 'true')
})

describe('uploading the backup', () => {
  it('seals the wallet and signs the upload', async () => {
    await markBackupReady()
    ;(axios.put as jest.Mock).mockResolvedValue({ data: {} })
    expect(await uploadBackup()).toBe('uploaded')
    const [target, body] = (axios.put as jest.Mock).mock.calls[0]
    expect(target).toBe(url)
    expect(JSON.parse(open(keys, body.ciphertext)).credentials).toEqual([{ id: 'urn:uuid:local' }])
    expect(body.proof.split('.')).toHaveLength(3)
    expect(JSON.stringify(body)).not.toContain('did:')
  })

  it('never uploads while waiting for the backup to come back', async () => {
    await markRestoring()
    expect(await uploadBackup()).toBe('not-ready')
    expect(axios.put).not.toHaveBeenCalled()
  })

  it('goes past a version another phone uploaded', async () => {
    await markBackupReady()
    ;(axios.put as jest.Mock)
      .mockRejectedValueOnce({
        response: { status: 409, data: { reason: 'StaleVersion', version: 9_999_999_999_999 } },
      })
      .mockResolvedValueOnce({ data: {} })
    expect(await uploadBackup()).toBe('uploaded')
    expect((axios.put as jest.Mock).mock.calls[1][1].version).toBe(10_000_000_000_000)
  })
})

describe('restoring the backup', () => {
  it('brings the certificates back and keeps what the wallet holds', async () => {
    await markRestoring()
    ;(axios.get as jest.Mock).mockResolvedValue(
      remote({ credentials: [{ id: 'urn:uuid:backed-up' }], presentations: [{ id: 'vp-1' }], actionLogs: [] }),
    )
    expect(await restoreBackup()).toEqual({ found: true, credentials: 2 })
    expect(mockWallet.credentials.map((c: any) => c.id).sort()).toEqual(['urn:uuid:backed-up', 'urn:uuid:local'])
    expect(mockWallet.presentations).toEqual([{ id: 'vp-1' }])
    // Restored: uploads go ahead again.
    ;(axios.put as jest.Mock).mockResolvedValue({ data: {} })
    expect(await uploadBackup()).toBe('uploaded')
  })

  it('finds no backup for a wallet that never made one, and goes on', async () => {
    await markRestoring()
    ;(axios.get as jest.Mock).mockRejectedValue({ response: { status: 404 } })
    expect(await restoreBackup()).toEqual({ found: false, credentials: 1 })
  })

  it('keeps waiting when the back-office cannot be reached', async () => {
    await markRestoring()
    ;(axios.get as jest.Mock).mockRejectedValue(new Error('Network Error'))
    await expect(restoreBackup()).rejects.toThrow(BackupUnavailable)
    expect(await uploadBackup()).toBe('not-ready')
  })
})

describe('fetching the backup before anything is installed', () => {
  it('tells a back-office out of reach from one with no backup', async () => {
    for (const failure of [new Error('Network Error'), { response: { status: 503 } }, { response: { status: 429 } }]) {
      ;(axios.get as jest.Mock).mockRejectedValueOnce(failure)
      await expect(downloadBackup(keys)).rejects.toBeInstanceOf(BackupUnavailable)
    }
    ;(axios.get as jest.Mock).mockRejectedValueOnce({ response: { status: 404 } })
    expect(await downloadBackup(keys)).toBeNull()
  })

  it('brings a downloaded backup into the wallet installed after it', async () => {
    ;(axios.get as jest.Mock).mockResolvedValue(
      remote({ credentials: [{ id: 'urn:uuid:backed-up' }], presentations: [], actionLogs: [] }, 7),
    )
    const backup = await downloadBackup(keys)
    expect(backup?.version).toBe(7)
    expect(await mergeBackup(backup!)).toBe(2)
    expect(mockWallet.credentials.map((c: any) => c.id).sort()).toEqual(['urn:uuid:backed-up', 'urn:uuid:local'])
  })
})
