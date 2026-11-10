import { MD3DarkTheme, MD3LightTheme, MD3Theme, configureFonts } from 'react-native-paper'
import Color from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

const fonts = configureFonts({ config: { fontFamily: FONT_FAMILY.PRINCIPAL } })

const themes: Partial<Record<'light' | 'dark', MD3Theme>> = {}

export const getPaperTheme = (scheme: 'light' | 'dark'): MD3Theme => {
  if (!themes[scheme]) themes[scheme] = build(scheme)
  return themes[scheme] as MD3Theme
}

const build = (scheme: 'light' | 'dark'): MD3Theme => {
  const base = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme
  const c = Color[scheme]
  const dark = scheme === 'dark'
  return {
    ...base,
    fonts,
    colors: {
      ...base.colors,
      primary: c.primary,
      onPrimary: c.buttonText,
      primaryContainer: dark ? '#1C3566' : '#DCE7FB',
      onPrimaryContainer: dark ? '#DCE7FB' : '#0A1F3D',
      secondary: c.secondary,
      secondaryContainer: dark ? '#1C3566' : '#DCE7FB',
      onSecondaryContainer: dark ? '#DCE7FB' : '#0A1F3D',
      tertiary: c.accent,
      error: c.error,
      background: c.background,
      onBackground: c.text,
      surface: c.background,
      onSurface: c.text,
      surfaceVariant: c.surface,
      onSurfaceVariant: c.mutedText,
      outline: dark ? '#4A5568' : '#A9B3C2',
      outlineVariant: c.border,
      elevation: dark
        ? {
            level0: 'transparent',
            level1: '#141B27',
            level2: '#172030',
            level3: '#1A2436',
            level4: '#1B2638',
            level5: '#1E2A3E',
          }
        : {
            level0: 'transparent',
            level1: '#F6F8FC',
            level2: '#F1F4FA',
            level3: '#ECF0F7',
            level4: '#EAEEF6',
            level5: '#E6EBF4',
          },
    },
  }
}
