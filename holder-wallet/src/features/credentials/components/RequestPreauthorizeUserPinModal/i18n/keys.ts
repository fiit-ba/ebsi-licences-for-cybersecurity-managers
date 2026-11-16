// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/credentials/components/RequestPreauthorizeUserPinModal/i18n/sk'

const keys = Object.keys(sk)
const requestPreauthorizeUserPinModalI18nKeys: Record<keyof typeof sk, any> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default requestPreauthorizeUserPinModalI18nKeys
