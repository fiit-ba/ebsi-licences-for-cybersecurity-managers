// The backup's keys, derived from the identity key (design decisions D31).
// HKDF-SHA-256 over the identity's private key, under a salt of the format's
// own and one label per key: the AES key that encrypts the backup and a P-256
// key that signs each upload. The backup's address on the back-office is that
// signing key's RFC 7638 thumbprint. All three come back from the recovery
// phrase, and none of them leads back to the identity key or its DID.
import Crypto from 'react-native-quick-crypto'
import { ec as EC } from 'elliptic'
import { PublicJwk, derivedKey, publicJwk, sha256, thumbprint } from '@infrastructure/crypto/p256'

export { sha256, thumbprint }

const SALT = 'PLR-WALLET-BACKUP-V1'

export type BackupKeys = {
  /** The backup's address: the signing key's thumbprint. */
  backupId: string
  /** AES-256-GCM key. */
  encryptionKey: Buffer
  signingKey: EC.KeyPair
  publicJwk: PublicJwk
}

export const backupKeys = (identityPrivateKeyHex: string): BackupKeys => {
  const identityKey = Buffer.from(String(identityPrivateKeyHex).replace(/^0x/, ''), 'hex')
  if (identityKey.length !== 32) throw new Error('The identity key is 32 bytes')
  const signingKey = derivedKey(identityKey, SALT, 'signing', '/')
  const jwk = publicJwk(signingKey)
  return {
    backupId: thumbprint(jwk),
    encryptionKey: Buffer.from(Crypto.hkdfSync('sha256', identityKey as any, SALT, 'encryption', 32) as any),
    signingKey,
    publicJwk: jwk,
  }
}
