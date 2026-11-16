import 'react-native-get-random-values'
import '@ethersproject/shims'
import Crypto from 'react-native-quick-crypto'
import { JWK, base64url } from 'jose'
import { computePublicKey } from 'ethers/lib/utils'
import { ec as EC } from 'elliptic'
import bs58 from 'bs58'
import sodium from 'react-native-libsodium'
import { hdkey } from 'ethereumjs-wallet'
import { publicToAddress, toChecksumAddress } from 'ethereumjs-util'

export function base64urlEncode(str: string | number[] | Uint8Array | Buffer) {
  let data: string | Uint8Array = str as any
  // Normalizes every binary input for the current base64url encoder.
  if (Array.isArray(str)) {
    data = Uint8Array.from(str as number[])
  } else if (typeof str !== 'string') {
    data = Uint8Array.from(str)
  }
  return base64url.encode(data)
}

export function base64urlDecode(derSign: string | number[] | Uint8Array) {
  let data: string | Uint8Array = derSign as any
  if (typeof derSign === typeof []) {
    data = Uint8Array.from(derSign as number[])
  }
  return base64url.decode(data)
}

export const generateRandomHex = (num: number) => {
  const randomString = Buffer.from(Crypto.randomBytes(num)).toString('hex')
  return randomString
}

export const getPublicKeyFromPrivateKey = (userPrivateKey: string) => {
  return computePublicKey(userPrivateKey)
}

export const digest = async (algorithm: string, data: any) => {
  const digest = Crypto.createHash(algorithm)
  digest.update(data)
  const result = digest.digest()
  return new Uint8Array(result)
}

export const hashSha256 = async (data: any) => {
  const digest = Crypto.createHash('sha256')
  digest.update(data)
  const result = digest.digest('hex')
  return result
}

export const keyFromJWK = async (jwk: JWK, curveParam: string): Promise<EC.KeyPair> => {
  const curve: EC = new EC(curveParam)
  const keyParams: any = {}
  const hasPub = jwk.x && jwk.y
  if (hasPub) {
    keyParams.pub = {
      x: base64urlDecode(jwk.x as string),
      y: base64urlDecode(jwk.y as string),
    }
  }
  const key = curve.keyPair(keyParams)
  return key
}

export const convertBase58ToHex = (publicKeyBase58: string) => {
  const clave = Buffer.from(bs58.decode(publicKeyBase58)).toString()
  const claveJson = JSON.parse(clave)
  const coordX = claveJson.x.replace('_', '/').replace('-', '+')
  const bufferX = Buffer.from(coordX, 'base64')
  const bufStringX = bufferX.toString('hex')
  const coordY = claveJson.y.replace('_', '/').replace('-', '+')
  const bufferY = Buffer.from(coordY, 'base64')
  const bufStringY = bufferY.toString('hex')
  const hexKey = '0x04' + bufStringX + bufStringY
  return hexKey
}

export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  await sodium.ready
  const keyPair = sodium.crypto_sign_keypair()

  const privateKey = Buffer.from(keyPair.privateKey).toString('hex')
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex')

  return {
    privateKey,
    publicKey,
  }
}
// Recreates OpenSSL's legacy password-based AES derivation because quick-crypto removed createCipher.
type BinaryLike = string | Uint8Array | Buffer

const deriveLegacyAesKeyAndIv = (password: BinaryLike) => {
  const passwordBytes = Buffer.from(password as any) as any
  const material: any[] = []
  let previous: any = Buffer.alloc(0)
  let length = 0
  while (length < 48) {
    const hash = Crypto.createHash('md5')
    hash.update(Buffer.concat([previous, passwordBytes]) as any)
    previous = Buffer.from(hash.digest())
    material.push(previous)
    length += previous.length
  }
  const derived = Buffer.concat(material as any)
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) }
}

export const encryptData = (data: string, password: BinaryLike) => {
  // Uses the derived legacy key and IV to keep existing encrypted wallet data readable.
  const { key, iv } = deriveLegacyAesKeyAndIv(password)
  const cipher = Crypto.createCipheriv('aes-256-cbc', key as any, iv as any)
  let encryptedData = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  encryptedData += cipher.final('hex')
  return encryptedData
}

export const decryptData = (encryptedData: string | ArrayBuffer, password: string): any => {
  try {
    // Mirrors encryption's legacy derivation so pre-migration ciphertext remains compatible.
    const { key, iv } = deriveLegacyAesKeyAndIv(password)
    const decipher = Crypto.createDecipheriv('aes-256-cbc', key as any, iv as any)
    let decryptedData = decipher.update(encryptedData, 'hex', 'utf8')
    decryptedData += decipher.final('utf8')
    return JSON.parse(decryptedData as string)
  } catch (error) {
    console.error('Error decrypting data: ' + error)
  }
}

export const selectCurve = (alg: 'ES256' | 'ES256K' | undefined) => {
  if (!alg) {
    throw new Error('Algorithm is undefined')
  }
  const curve = alg === 'ES256' ? 'p256' : 'secp256k1'
  return curve
}

export const getXpubFromEpicDID = (did: string): string | null => {
  const prefix = 'did:epic:quor:redT:'
  if (!did.startsWith(prefix)) {
    console.info('Invalid DID prefix')
    return null
  }

  const remainder = did.substring(prefix.length)

  const [baseKey] = remainder.split('?')

  if (!baseKey) {
    console.error('Invalid DID structure, missing base key')
    return null
  }

  return baseKey
}

export const getEthAddressFromExtenderPublicKey = (issuerDid: any) => {
  const xpub = getXpubFromEpicDID(issuerDid)

  if (!xpub) return

  const wallet = hdkey.fromExtendedKey(xpub!).getWallet()
  const publicKey = wallet.getPublicKey()

  const addressBuffer = publicToAddress(publicKey, true)
  const address = toChecksumAddress(`0x${addressBuffer.toString('hex')}`)

  return address
}
