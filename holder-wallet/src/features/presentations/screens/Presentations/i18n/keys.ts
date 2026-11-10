// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/presentations/screens/Presentations/i18n/sk'

const keys = Object.keys(sk)
const PresentationsI18nKeys: Record<keyof typeof sk, keyof typeof sk> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default PresentationsI18nKeys
