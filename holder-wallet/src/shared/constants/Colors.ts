import { Appearance, ColorSchemeName } from 'react-native'
import { DarkTheme, DefaultTheme } from '@react-navigation/native'
// The wallet's own palette (see docs/WALLET.md) in place of the generic
// coral and slate. Navy carries the brand (headers, splash, icon), blue is
// the one action colour, and error is its own red: it used to be the primary
// colour, so a revoked certificate looked like a button.
const navy = '#0A1F3D'
const tintColorLight = navy
const tintColorDark = '#fff'
const tintColorDarkOpaque = '#fff8'

export const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#ffffff',
  },
}

const Color = {
  light: {
    primary: '#1F5FD1',
    secondary: navy,
    accent: '#0F9F8F',
    error: '#C62828',
    success: '#15803D',
    text: '#0B1220',
    mutedText: '#5B6576',
    invertedText: '#fff',
    background: '#fff',
    surface: '#F2F5FA',
    border: '#DDE3EC',
    headerBackground: navy,
    scrollBackground: '#EEF2F8',
    titleMenu: '#fff',
    tint: tintColorLight,
    tabIconDefault: '#8A94A6',
    tabIconSelected: tintColorLight,
    loading: tintColorDarkOpaque,
    disabled: '#B8C0CC',
    placeholder: '#8A94A6',
    inactiveDot: '#ffffff55',
    buttonText: '#fff',
    // An organization's frame - header, tab bar, its own screens - in violet,
    // apart from the holder's navy and blue and from the colours of a
    // certificate's state (design decisions D15).
    orgHeader: '#3B1C70',
    orgPrimary: '#6D28D9',
    orgSurface: '#F3EEFD',
  },
  dark: {
    primary: '#4F86F7',
    secondary: '#8FB2FF',
    accent: '#2DD4BF',
    error: '#F26D6D',
    success: '#4ADE80',
    text: '#F3F6FA',
    mutedText: '#A3ADBD',
    invertedText: '#fff',
    background: '#0B0F17',
    surface: '#161D2A',
    border: '#263042',
    headerBackground: navy,
    scrollBackground: '#1A2230',
    titleMenu: '#13294B',
    tint: tintColorDark,
    tabIconDefault: '#8A94A6',
    tabIconSelected: tintColorDark,
    loading: tintColorDarkOpaque,
    disabled: '#3A4456',
    placeholder: '#8A94A6',
    inactiveDot: '#ffffff55',
    buttonText: '#fff',
    // The organization's violet, lighter on the dark background.
    orgHeader: '#3B1C70',
    orgPrimary: '#A78BFA',
    orgSurface: '#231A38',
  },
  warning: '#B45309',
}
// The navigator's dark theme on the palette's background, not near-black.
export const navDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Color.dark.primary,
    background: Color.dark.background,
    card: Color.dark.surface,
    border: Color.dark.border,
  },
}

const keys = Object.keys(Color.light)
export const ColorKeys: Record<keyof typeof Color.light, keyof typeof Color.light> = keys.reduce(
  (accum: any, key) => ({ ...accum, [key]: key }),
  {},
)
// The colour scheme is fixed when the app starts.
// Most backgrounds are computed once, when their style module loads; text
// colours were read from the system at every render. When the system switched
// between light and dark with the wallet open - Android's automatic night mode
// does that on a schedule - the two disagreed: black text on the black
// backgrounds of a dark start, white on white the other way round. Every
// colour, the navigation theme and react-native-paper's theme now come from
// this one value, so the app stays consistent and follows a new system
// setting the next time it starts.
let appColorScheme: 'light' | 'dark' | null = null

export const getAppColorScheme = (): 'light' | 'dark' => {
  if (appColorScheme === null) {
    appColorScheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'
  }
  return appColorScheme
}

export const getThemeColor = (name: keyof typeof Color.light, specificTheme?: 'light' | 'dark'): string => {
  const theme: ColorSchemeName =
    specificTheme === 'dark' || specificTheme === 'light' ? specificTheme : getAppColorScheme()
  const themeColors = Color[theme || 'light'] as typeof Color.light
  return themeColors[name]
}

export const getColorByBackground = (name: keyof typeof Color.light, background: string): string => {
  const theme: 'light' | 'dark' = getBackgroundTheme(background)
  const themeColors = Color[theme || 'light'] as typeof Color.light
  return themeColors[name]
}

export const isDark = (color: string) => {
  return getBackgroundTheme(color) === 'dark'
}

export function getBackgroundTheme(bgColor: string | undefined): 'light' | 'dark' {
  if (bgColor == undefined) return 'light'
  try {
    const isSimpleBackground = bgColor.length === 4
    const numberLettersPerColor = isSimpleBackground ? 1 : 2
    const rStart = 1
    const gStart = rStart + numberLettersPerColor
    const bStart = gStart + numberLettersPerColor
    // Extract the red, green, and blue values from the background color
    const r = parseInt(bgColor.substring(rStart, rStart + numberLettersPerColor), 16)
    const g = parseInt(bgColor.substring(gStart, gStart + numberLettersPerColor), 16)
    const b = parseInt(bgColor.substring(bStart, bStart + numberLettersPerColor), 16)

    // Calculate the brightness of the color
    const brightness = (r * 299 + g * 587 + b * 114) / 1000

    // If the brightness is greater than 128, it's a light theme. Otherwise, it's dark.
    return brightness > 128 ? 'light' : 'dark'
  } catch (error) {
    return 'light'
  }
}

export default Color
