/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */

import { Text as DefaultText, View as DefaultView } from 'react-native'

import Colors from '@shared/constants/Colors'
import useColorScheme from '@shared/hooks/useColorScheme'

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
  specificTheme?: 'light' | 'dark',
) {
  // Normalizes a null system scheme before indexing the two explicit application themes.
  const systemTheme = useColorScheme()
  const selectedTheme = specificTheme || systemTheme
  const theme = selectedTheme === 'dark' ? 'dark' : 'light'
  const colorFromProps = props[theme]

  if (colorFromProps) {
    return colorFromProps
  } else {
    return Colors[theme][colorName]
  }
}

type ThemeProps = {
  lightColor?: string
  darkColor?: string
  theme?: 'light' | 'dark'
}

export type TextProps = ThemeProps & DefaultText['props']
export type ViewProps = ThemeProps & DefaultView['props']

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text')

  return <DefaultText style={[{ color }, style]} {...otherProps} />
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, theme, ...otherProps } = props
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background', props.theme)

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />
}
