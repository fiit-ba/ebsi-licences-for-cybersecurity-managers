import { ec as EC } from 'elliptic'
import { base64url } from 'jose'
import { encryptData } from '@infrastructure/crypto/legacyCrypto'
import { generateIdentityWallet } from '@infrastructure/identity/hd-wallets'
export const identityPrivateKey = (mnemonic: string, path: string): string => {
  const wallet = generateIdentityWallet(mnemonic, path)
  if (!wallet) throw 'Error, mnemonic is undefined'
  return wallet.getPrivateKeyString()
}
export const encryptPrivateKey = (privateKey: string, pin: string): string => encryptData(privateKey, pin)
export const jwkKeysFromPrivateKey = (walletPrivateKey: string) => {
  const keyPair = new EC('secp256k1').keyFromPrivate(walletPrivateKey.substring(2))
  const x = keyPair.getPublic().getX().toBuffer('be', 32)
  const y = keyPair.getPublic().getY().toBuffer('be', 32)
  const d = keyPair.getPrivate().toBuffer('be', 32)
  const publicKeyJWK = {
    crv: 'secp256k1',
    kty: 'EC',
    x: base64url.encode(Uint8Array.from(x)),
    y: base64url.encode(Uint8Array.from(y)),
  }
  return {
    privateKeyJWK: { ...publicKeyJWK, d: base64url.encode(Uint8Array.from(d)) },
    publicKeyJWK,
    privateKeyHex: d.toString('hex'),
    publicKeyHex: keyPair.getPublic('hex'),
  }
}
