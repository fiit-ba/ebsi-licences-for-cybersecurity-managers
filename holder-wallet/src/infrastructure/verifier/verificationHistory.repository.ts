import { ActionLog } from '@infrastructure/openid/types'
import { getKeychainDataObject, setKeychainDataObject } from '@infrastructure/persistence/keychain'
import { activeProfile, addOrganizationLog } from '@infrastructure/organization/OrganizationService'
export const appendVerificationHistory = async (entry: ActionLog): Promise<void> => {
  if (activeProfile() === 'organization') {
    await addOrganizationLog(entry)
    return
  }
  const wallet = await getKeychainDataObject()
  if (!wallet) throw new Error('ERROR_NO_PRIVATE_KEY')
  wallet.actionLogs = [...(wallet.actionLogs ?? []), entry]
  await setKeychainDataObject(wallet)
}
