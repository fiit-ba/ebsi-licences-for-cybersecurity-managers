import * as Keychain from 'react-native-keychain'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { ORGANIZATION_KEYCHAIN_SERVICE } from '@infrastructure/organization/organizationProfile.repository'

export const deleteAllKeychainData = async () => {
  try {
    await Keychain.resetGenericPassword()
    await LocalStorageService.clearAll()
    return true
  } catch (error) {
    console.error('Error deleting keychain data:', error)
    return false
  }
}

export const deleteHolderWallet = async () => {
  await Keychain.resetGenericPassword()
  for (const key of [
    STORAGE_KEYS.IS_WALLET_CREATED,
    STORAGE_KEYS.IS_DID_CREATED,
    STORAGE_KEYS.PRIVATE_KEY,
    STORAGE_KEYS.PIN,
  ]) {
    await LocalStorageService.removeItem(key).catch(() => undefined)
  }
}

export const checkIfAppWasReinstalled = async () => {
  await LocalStorageService.removeItem(STORAGE_KEYS.PIN)
  const installed = await LocalStorageService.getBool(STORAGE_KEYS.APP_WAS_INSTALLED)
  if (installed) return

  await deleteAllKeychainData()
  await Keychain.resetGenericPassword({ service: ORGANIZATION_KEYCHAIN_SERVICE })
  await LocalStorageService.storeBool(STORAGE_KEYS.APP_WAS_INSTALLED, true)
}
