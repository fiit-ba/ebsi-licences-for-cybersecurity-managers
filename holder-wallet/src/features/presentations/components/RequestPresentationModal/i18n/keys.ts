// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/presentations/components/RequestPresentationModal/i18n/sk'

const keys = Object.keys(sk)
const requestPresentationModalI18nKeys: Record<keyof typeof sk, any> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default requestPresentationModalI18nKeys
