import sk from '@features/recovery/screens/Restore/i18n/sk'

const RestoreI18nKeys: Record<keyof typeof sk, string> = Object.keys(sk).reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default RestoreI18nKeys
