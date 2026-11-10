import { generateMnemonic } from '@dreson4/react-native-quick-bip39'
import { derivationPathFor } from '@domain/identity/recovery'
import { WalletSecurityInformation } from '@shared/interfaces/wallet'
import { SessionPin } from '@infrastructure/security/SessionPin'
import { toWalletSecurityInformation } from './wallet.mapper'
import { encryptPrivateKey, identityPrivateKey, jwkKeysFromPrivateKey } from './walletCrypto.adapter'
import { saveEncryptedIdentity, saveIdentityJwks } from './wallet.repository'
import { validateRecoveryPhrase } from './recoveryPhrase.validator'
const installIdentity = async (mnemonic: string, derivationPath: string, pin: string): Promise<void> => {
  const privateKey = identityPrivateKey(mnemonic, derivationPath)
  await saveEncryptedIdentity(encryptPrivateKey(privateKey, pin))
  SessionPin.set(pin)
  await saveIdentityJwks(jwkKeysFromPrivateKey(privateKey))
}
export const createEncryptedWallet = async (pin: string): Promise<WalletSecurityInformation> => {
  const mnemonic = generateMnemonic()
  const derivationPath = derivationPathFor(mnemonic)
  await installIdentity(mnemonic, derivationPath, pin)
  return toWalletSecurityInformation(mnemonic, derivationPath)
}
export const identityKeyOf = (phrase: string): string => {
  const { mnemonic, path } = validateRecoveryPhrase(phrase)
  return identityPrivateKey(mnemonic, path)
}
export const restoreWallet = async (phrase: string, pin: string): Promise<void> => {
  const { mnemonic, path } = validateRecoveryPhrase(phrase)
  await installIdentity(mnemonic, path, pin)
}
