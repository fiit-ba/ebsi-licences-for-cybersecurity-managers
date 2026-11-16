// The keys, built from the Slovak strings, the default language.
import sk from '@features/verification/screens/Verify/i18n/sk'

const keys = Object.keys(sk)
const VerifyI18nKeys: Record<keyof typeof sk, keyof typeof sk> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default VerifyI18nKeys
