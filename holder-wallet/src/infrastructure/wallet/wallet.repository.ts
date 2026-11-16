import { saveJWKKeys, setKeychainDataObject } from '@infrastructure/persistence/keychain'
import { KeyChainData } from '@infrastructure/persistence/keychain/keychain.types'
export const saveEncryptedIdentity = (encryptedPrivateKey: string) => {
  const data: KeyChainData = { encryptedPrivateKey }
  return setKeychainDataObject(data)
}
export const saveIdentityJwks = ({ privateKeyJWK, publicKeyJWK, privateKeyHex, publicKeyHex }: any) =>
  saveJWKKeys(privateKeyJWK, publicKeyJWK, privateKeyHex, publicKeyHex)
