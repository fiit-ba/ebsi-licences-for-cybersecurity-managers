import OpenIdService from '@infrastructure/openid/OpenIdService'
import type {
  ActionLog,
  CredentialData,
  DeferredCredential,
  PresentationData,
  StoredItemStatus,
} from '@infrastructure/openid/types'
import { NO_KEYCHAIN_ERROR, readWallet, writeWallet } from './keychain.adapter'
import { toStoredCredential } from './credential.mapper'
import { addActionLog } from './history.repository'

export const saveCredential = async (item: string, itemType: 'credential', extra: Partial<CredentialData> = {}) => {
  try {
    const formatted = { ...toStoredCredential(item), ...extra, status: 'Active' as const }
    const wallet = await readWallet()
    if (!wallet) throw NO_KEYCHAIN_ERROR
    if (itemType === 'credential') {
      wallet.credentials = (wallet.credentials ?? []).filter(({ id }) => id !== formatted.id).concat([formatted])
      addActionLog(wallet, 'Credential added', formatted.id, formatted.issuer, formatted.validFrom, new Date())
    }
    await writeWallet(wallet)
    return true
  } catch (error) {
    console.error('Error saving credential:', error)
    throw error
  }
}

export const saveDeferredCredential = async (credential: DeferredCredential): Promise<boolean> => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  wallet.deferred_credentials = [...(wallet.deferred_credentials ?? []), { ...credential }].filter(Boolean)
  await writeWallet(wallet)
  return true
}

export const resolveKeychainDeferredCredentials = async () => {
  try {
    const wallet = await readWallet()
    if (!wallet?.deferred_credentials) return

    const pending: DeferredCredential[] = []
    await Promise.all(
      wallet.deferred_credentials.map(async (deferred) => {
        try {
          // OpenID4VCI 1.0: the transaction id, with the access token. A deferral saved by
          // an earlier wallet (acceptance_token) cannot be asked for any more.
          if (!deferred.transaction_id || !deferred.access_token) return
          const response = await OpenIdService.getDeferredCredentialRequest({
            transaction_id: deferred.transaction_id,
            access_token: deferred.access_token,
            deferredEndpoint: deferred.credential_endpoint,
          })
          const credential = response?.credentials?.[0]?.credential
          if (!credential) {
            pending.push(deferred)
            return
          }
          const resolved = toStoredCredential(credential)
          if (deferred.issuerUri) resolved.issuerUri = deferred.issuerUri
          wallet.credentials = (wallet.credentials ?? []).filter(({ id }) => id !== resolved.id).concat([resolved])
          addActionLog(wallet, 'Credential added', resolved.id, resolved.issuer, resolved.validFrom)
        } catch (error) {
          console.warn('Deferred credential not ready:', error)
          pending.push(deferred)
        }
      }),
    )
    wallet.deferred_credentials = pending
    await writeWallet(wallet)
  } catch (error) {
    console.error('Error resolving deferred credentials:', error)
  }
}

export const getCredentialsList = async () => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  return wallet.credentials?.reverse() ?? []
}

export const markItemStatus = async (
  itemId: Date | string,
  itemType: 'credential' | 'presentation',
  status: StoredItemStatus,
) => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  const items: (CredentialData | PresentationData)[] | undefined =
    itemType === 'credential' ? wallet.credentials : wallet.presentations
  if (!items) return

  const index = items.findIndex(({ timestamp }) => timestamp === itemId)
  if (index === -1 || items[index].status === 'Revoked' || items[index].status === status) return
  items[index].status = status
  const label = status === 'Revoked' ? 'revoked' : status === 'Suspended' ? 'suspended' : 'reinstated'
  addActionLog(
    wallet,
    `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} ${label}` as ActionLog['actionType'],
    items[index].id,
    items[index].issuer,
    items[index].validFrom,
    new Date(),
  )
  await writeWallet(wallet)
}

/** @deprecated Use markItemStatus, which also records suspension. */
export const markItemAsRevoked = (itemId: Date | string, itemType: 'credential' | 'presentation') =>
  markItemStatus(itemId, itemType, 'Revoked')
