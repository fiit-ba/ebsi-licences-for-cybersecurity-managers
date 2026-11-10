import sk from '@features/presentations/screens/Present/i18n/sk'

const PresentI18nKeys: Record<keyof typeof sk, string> = Object.keys(sk).reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default PresentI18nKeys
