import { derivationPathFor, isValidPhrase, normalizePhrase } from '@domain/identity/recovery'
export type WalletIdentity = { mnemonic: string; path: string }
export const validateRecoveryPhrase = (phrase: string): WalletIdentity => {
  const mnemonic = normalizePhrase(phrase)
  if (!isValidPhrase(mnemonic)) throw new Error('RESTORE_INVALID_PHRASE')
  return { mnemonic, path: derivationPathFor(mnemonic) }
}
