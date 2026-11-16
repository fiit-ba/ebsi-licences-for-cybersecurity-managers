// Builds the keys from the Slovak strings, the default language; the Spanish
// strings are removed.
import sk from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/i18n/sk'

const keys = Object.keys(sk)
const BottonTabNavigationHeaderI18nKeys: Record<keyof typeof sk, keyof typeof sk> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)

export default BottonTabNavigationHeaderI18nKeys
