// The holder's language: Slovak by default, English on request, and the
// choice kept on the device so the app starts in it next time.
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18next from 'i18next'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, SupportedLanguage } from '@shared/constants/i18n'

const STORAGE_KEY = 'plr.language'

const isSupported = (value: unknown): value is SupportedLanguage =>
  SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)

export const currentLanguage = (): SupportedLanguage =>
  isSupported(i18next.language) ? i18next.language : DEFAULT_LANGUAGE

/** Applies the saved language; called once, before the first screen. */
export const restoreLanguage = async (): Promise<void> => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY)
    if (isSupported(saved) && saved !== i18next.language) {
      await i18next.changeLanguage(saved)
    }
  } catch (error) {
    console.warn('[wallet] the saved language could not be read:', error)
  }
}

export const setLanguage = async (language: SupportedLanguage): Promise<void> => {
  await i18next.changeLanguage(language)
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language)
  } catch (error) {
    console.warn('[wallet] the language could not be saved:', error)
  }
}

/** A text given per language, in the active one; Slovak when it has none in it. */
export const inLanguage = <T>(texts: Record<typeof DEFAULT_LANGUAGE, T> & Partial<Record<SupportedLanguage, T>>): T =>
  texts[currentLanguage()] ?? texts[DEFAULT_LANGUAGE]

/** The other language, for a two-language switch. */
export const otherLanguage = (): SupportedLanguage => (currentLanguage() === 'sk' ? 'en' : 'sk')
