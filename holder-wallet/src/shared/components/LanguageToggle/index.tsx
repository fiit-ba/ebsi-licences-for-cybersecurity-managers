// SK | EN: the language switch where a holder starts - the onboarding and the
// sign-in screen. Inside the app it is in the header menu as well.
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '@shared/constants/i18n'
import { currentLanguage, otherLanguage, setLanguage } from '@app/localization/Language'
import { getAppColorScheme } from '@shared/constants/Colors'
import { styles } from '@shared/components/LanguageToggle/styles'

interface Props {
  /**
   * On a dark background (the brand navy), a light one, or the app's own
   * background, whose shade follows the colour scheme (the setup screens).
   */
  tone?: 'onDark' | 'onLight' | 'onBackground'
  /** The native navigation header already draws the outside capsule. */
  inHeader?: boolean
  onChanged?: () => void
}

const LanguageToggle = ({ tone = 'onDark', inHeader = false, onChanged }: Props) => {
  // Re-renders when the language changes.
  useTranslation()
  const active = currentLanguage()
  const onDark = tone === 'onDark' || (tone === 'onBackground' && getAppColorScheme() === 'dark')
  const next = otherLanguage()
  // The complete segmented control is one action. Previously only the SK or EN
  // text itself reliably received a press, while the surrounding capsule did not.
  const switchLanguage = async () => {
    await setLanguage(next)
    onChanged?.()
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active === 'sk' ? 'Prepnúť na angličtinu' : 'Switch to Slovak'}
      accessibilityValue={{ text: LANGUAGE_NAMES[active] }}
      hitSlop={4}
      onPress={switchLanguage}
      style={({ pressed }) => [
        styles.group,
        inHeader && styles.headerGroup,
        !inHeader && {
          borderColor: onDark ? 'rgba(255,255,255,0.35)' : 'rgba(10,31,61,0.25)',
        },
        pressed && styles.pressed,
      ]}
    >
      {SUPPORTED_LANGUAGES.map((language) => {
        const selected = language === active
        return (
          <View
            key={language}
            pointerEvents="none"
            style={[
              styles.option,
              inHeader && styles.headerOption,
              selected && { backgroundColor: onDark ? '#FFFFFF' : '#0A1F3D' },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: selected ? (onDark ? '#0A1F3D' : '#FFFFFF') : onDark ? '#FFFFFF' : '#0A1F3D' },
              ]}
            >
              {language.toUpperCase()}
            </Text>
          </View>
        )
      })}
    </Pressable>
  )
}

export default LanguageToggle
