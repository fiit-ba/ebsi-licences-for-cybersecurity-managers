import * as Keychain from 'react-native-keychain'
import { walletChanged } from '@infrastructure/backup/changes'
import type { KeyChainData } from './keychain.types'

export const HOLDER_KEYCHAIN_USERNAME = 'VaccinesData'
export const NO_KEYCHAIN_ERROR = 'No keychain stored'

export const writeWallet = async (data: KeyChainData): Promise<Keychain.Result | null | false> => {
  const result = await Keychain.setGenericPassword(HOLDER_KEYCHAIN_USERNAME, JSON.stringify(data)).catch((error) => {
    console.error('Keychain write failed:', error)
    throw new Error('ERROR_KEYCHAIN')
  })
  walletChanged()
  return result
}

export const readWallet = async (): Promise<KeyChainData | null> => {
  try {
    const credentials = await Keychain.getGenericPassword()
    return credentials ? (JSON.parse(credentials.password) as KeyChainData) : null
  } catch {
    return null
  }
}

export const deleteWalletEntry = (): Promise<boolean> => Keychain.resetGenericPassword()
