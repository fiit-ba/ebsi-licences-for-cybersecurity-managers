import { WalletSecurityInformation } from '@shared/interfaces/wallet'
export const toWalletSecurityInformation = (
  mnemonicPhrase: string,
  derivationPath: string,
): WalletSecurityInformation => ({ mnemonicPhrase, derivationPath })
