import { ColorSchemeName } from 'react-native'
import { getAppColorScheme } from '@shared/constants/Colors'

// The useColorScheme value is always either light or dark, but the built-in
// type suggests that it can be null. This will not happen in practice, so this
// makes it a bit easier to work with.
// The scheme the app started with, not the live system value - see
// getAppColorScheme in constants/Colors.ts for why the two must not diverge.
export default function useColorScheme(): NonNullable<ColorSchemeName> {
  return getAppColorScheme()
}
