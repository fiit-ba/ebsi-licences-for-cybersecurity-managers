// The wallet's identity from its recovery phrase alone (design decisions D31).
// The identity key sits at m/1037171/R/S/S/S/S/S/W under the phrase. R, the
// five S and W used to be random, and were shown once as the "derivation
// path": a holder who kept the phrase but not the path could not get the key
// back, nor the DID made from it. They are derived from the phrase now, so the
// twelve words give the same key and the same DID on any phone - and the DID
// stays where it was made, since nothing else is needed to recreate it.
import Crypto from 'react-native-quick-crypto'
import { utils as ethersUtils, wordlists } from 'ethers'

/** HMAC key the path's indexes are derived under; a new format gets a new one. */
const PATH_DOMAIN = 'PLR-WALLET-PATH-V1'

/** The phrase as it was generated: lower case, one space between the words. */
export const normalizePhrase = (text: string): string =>
  String(text ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/** Twelve (or more) BIP-39 words with a valid checksum. */
export const isValidPhrase = (text: string): boolean => {
  const phrase = normalizePhrase(text)
  return phrase.split(' ').length >= 12 && ethersUtils.isValidMnemonic(phrase)
}

/** The words of the phrase not in the BIP-39 list, to point at a typo. */
export const unknownWords = (text: string): string[] => {
  const list = wordlists.en
  return normalizePhrase(text)
    .split(' ')
    .filter((word) => word && list.getWordIndex(word) === -1)
}

/** The identity key's derivation path for this phrase (D31). */
export const derivationPathFor = (text: string): string => {
  const hmac = Crypto.createHmac('sha512', PATH_DOMAIN)
  hmac.update(normalizePhrase(text))
  const bytes = Buffer.from(hmac.digest() as Uint8Array)
  // Seven unhardened indexes, below 2^31 like the random ones were.
  const index = (i: number) => String(bytes.readUInt32BE(i * 4) & 0x7fffffff)
  return ['m', '1037171', ...Array.from({ length: 7 }, (_, position) => index(position))].join('/')
}
