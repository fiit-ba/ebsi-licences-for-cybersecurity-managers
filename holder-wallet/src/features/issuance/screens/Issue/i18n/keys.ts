// The keys, built from the Slovak strings, the default language.
import sk from '@features/issuance/screens/Issue/i18n/sk'

const keys = Object.keys(sk)
const IssueI18nKeys: Record<keyof typeof sk, keyof typeof sk> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default IssueI18nKeys
