// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/identity/screens/DidList/i18n/sk'

const keys = Object.keys(sk)
const DidListI18nKeys: Record<keyof typeof sk, string> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default DidListI18nKeys
