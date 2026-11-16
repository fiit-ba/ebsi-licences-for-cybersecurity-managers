// The keys, built from the Slovak strings, the default language.
import sk from '@features/organization/screens/Organization/i18n/sk'

const keys = Object.keys(sk)
const OrganizationI18nKeys: Record<keyof typeof sk, keyof typeof sk> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default OrganizationI18nKeys
