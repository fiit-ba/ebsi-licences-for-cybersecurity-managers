// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/credentials/components/RequestCredentialModal/i18n/sk'

const keys = Object.keys(sk)
const requestCredentialModalI18nKeys: Record<keyof typeof sk, any> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default requestCredentialModalI18nKeys
