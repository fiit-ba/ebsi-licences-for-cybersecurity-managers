import Crypto from 'react-native-quick-crypto'
export const PIN_ITERATIONS = 100_000
export const newPinSalt = (): string => Crypto.randomBytes(16).toString('hex')
export const hashOrganizationPin = (pin: string, salt: string, iterations: number): string =>
  Crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('hex')
export const equalPinHashes = (candidate: string, expected: string): boolean => {
  let difference = candidate.length ^ expected.length
  for (let i = 0; i < Math.min(candidate.length, expected.length); i++)
    difference |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  return difference === 0
}
