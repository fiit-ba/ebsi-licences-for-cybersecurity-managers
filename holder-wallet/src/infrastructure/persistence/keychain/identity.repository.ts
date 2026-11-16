import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { decryptData } from '@infrastructure/crypto/legacyCrypto'
import { SessionPin } from '@infrastructure/security/SessionPin'
import type { TrustedFramework } from '@infrastructure/openid/types'
import { readWallet, writeWallet } from './keychain.adapter'

type JsonObject = Record<string, unknown>

export const checkPin = async (pin: string): Promise<boolean> => {
  try {
    const encryptedKey = (await readWallet())?.encryptedPrivateKey
    return encryptedKey ? Boolean(decryptData(encryptedKey, pin)) : false
  } catch (error) {
    console.error(error)
    return false
  }
}

export const getPrivateKey = async (): Promise<string | null> => {
  const encryptedKey = (await readWallet())?.encryptedPrivateKey
  if (!encryptedKey) return null
  return decryptData(encryptedKey, SessionPin.get())
}

export const saveJWKKeys = async (
  privateKeyJWK: JsonObject,
  publicKeyJWK: JsonObject,
  privateKeyHex: string,
  publicKeyHex: string,
) => {
  const wallet = await readWallet()
  if (!wallet) return null

  wallet.JWKKeys = {
    privateKeyJWK: JSON.stringify(privateKeyJWK),
    publicKeyJWK: JSON.stringify(publicKeyJWK),
    privateKeyHex: JSON.stringify(privateKeyHex),
    publicKeyHex: JSON.stringify(publicKeyHex),
  }
  await writeWallet(wallet)
  return wallet.JWKKeys
}

export const getJWKKeys = async (): Promise<{
  privateKeyJWK: JsonObject
  publicKeyJWK: JsonObject
  privateKeyHex: string
  publicKeyHex: string
} | null> => {
  const keys = (await readWallet())?.JWKKeys
  if (!keys) return null
  return {
    privateKeyJWK: JSON.parse(keys.privateKeyJWK) as JsonObject,
    publicKeyJWK: JSON.parse(keys.publicKeyJWK) as JsonObject,
    privateKeyHex: JSON.parse(keys.privateKeyHex) as string,
    publicKeyHex: JSON.parse(keys.publicKeyHex) as string,
  }
}

export const saveSignatureKeys = async (keyPair: { privateKey: string; publicKey: string }) => {
  const wallet = await readWallet()
  if (!wallet) return null
  wallet.signatureKeyPair = keyPair
  await writeWallet(wallet)
  return wallet.signatureKeyPair
}

export const getSignatureKeys = async (): Promise<{ privateKey: string; publicKey: string } | null> =>
  (await readWallet())?.signatureKeyPair ?? null

export const saveDID = async (did: string, framework: TrustedFramework): Promise<boolean> => {
  const wallet = await readWallet()
  if (!wallet || !did) return false
  wallet.did = { ...wallet.did, [framework]: did }
  await writeWallet(wallet)
  await LocalStorageService.storeBool(STORAGE_KEYS.IS_DID_CREATED, true)
  return true
}

export const getDid = async (framework: TrustedFramework): Promise<string | null> => {
  const wallet = await readWallet()
  if (!wallet) return null
  const did = wallet.did?.[framework]
  if (did == null) throw new Error('ERROR_NO_DID')
  return did
}

export const getDidList = async (): Promise<Array<{ network: string; entity: string; did: string | undefined }>> => {
  const did = (await readWallet())?.did?.ebsi
  return did ? [{ network: 'main', entity: 'ebsi', did }] : []
}
