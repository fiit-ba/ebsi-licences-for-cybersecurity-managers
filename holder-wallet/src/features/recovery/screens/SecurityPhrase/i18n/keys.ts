// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/recovery/screens/SecurityPhrase/i18n/sk'

const keys = Object.keys(sk)
const SecurityPhraseI18nKeys: Record<keyof typeof sk, string> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default SecurityPhraseI18nKeys
