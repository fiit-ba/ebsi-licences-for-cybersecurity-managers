// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@shared/components/ConfirmationDialog/i18n/sk'

const keys = Object.keys(sk)
const ConfirmationDialogI18nKeys: Record<keyof typeof sk, string> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default ConfirmationDialogI18nKeys
