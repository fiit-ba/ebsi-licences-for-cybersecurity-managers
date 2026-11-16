import type { ActionLog } from '@infrastructure/openid/types'
import type { KeyChainData } from './keychain.types'
import { NO_KEYCHAIN_ERROR, readWallet, writeWallet } from './keychain.adapter'

export const addActionLog = (
  wallet: KeyChainData,
  actionType: ActionLog['actionType'],
  id: string,
  issuer: string,
  validFrom: Date | string,
  customDate?: Date,
) => {
  const date = validFrom instanceof Date ? validFrom : new Date(validFrom)
  const log: ActionLog = { id, actionType, issuer, date: customDate || date }
  wallet.actionLogs = wallet.actionLogs ? [...wallet.actionLogs, log] : [log]
}

export const getActionLogs = async () => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  return [...(wallet.actionLogs || [])].reverse()
}

export const checkAndLogExpiredCredentials = async () => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR

  let added = false
  if (wallet.credentials && wallet.actionLogs) {
    const now = new Date()
    for (const credential of wallet.credentials) {
      const alreadyLogged = wallet.actionLogs.some(
        (log) => log.actionType === 'Credential expired' && log.id === credential.id,
      )
      if (!alreadyLogged && credential.expirationDate && new Date(credential.expirationDate) < now) {
        addActionLog(wallet, 'Credential expired', credential.id, credential.issuer, now)
        added = true
      }
    }
  }
  if (added) await writeWallet(wallet)
}
