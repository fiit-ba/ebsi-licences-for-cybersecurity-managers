import * as Keychain from 'react-native-keychain'
import { Organization } from '@domain/organization/organization'
import { ActionLog } from '@infrastructure/openid/types'
export type StoredProfile = Organization & {
  pin: { salt: string; iterations: number; hash: string }
  logs: ActionLog[]
}
export const ORGANIZATION_KEYCHAIN_SERVICE = 'plr.organization'
export const readOrganizationProfile = async (): Promise<StoredProfile | null> => {
  const entry = await Keychain.getGenericPassword({ service: ORGANIZATION_KEYCHAIN_SERVICE })
  return entry ? JSON.parse(entry.password) : null
}
export const writeOrganizationProfile = async (profile: StoredProfile): Promise<void> => {
  const saved = await Keychain.setGenericPassword(profile.username, JSON.stringify(profile), {
    service: ORGANIZATION_KEYCHAIN_SERVICE,
  })
  if (!saved) throw new Error('ERROR_KEYCHAIN')
}
export const deleteOrganizationProfileEntry = () =>
  Keychain.resetGenericPassword({ service: ORGANIZATION_KEYCHAIN_SERVICE })
