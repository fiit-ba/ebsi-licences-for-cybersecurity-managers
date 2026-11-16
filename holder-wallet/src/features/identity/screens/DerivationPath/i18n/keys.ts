// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/identity/screens/DerivationPath/i18n/sk'

const keys = Object.keys(sk)
const DerivationPathI18nKeys: Record<keyof typeof sk, string> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default DerivationPathI18nKeys
