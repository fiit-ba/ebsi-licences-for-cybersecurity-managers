// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@features/authentication/screens/Login/i18n/sk'

const keys = Object.keys(sk)
const LoginI18nKeys: Record<keyof typeof sk, string> = keys.reduce((accum: any, key) => ({ ...accum, [key]: key }), {})

export default LoginI18nKeys
