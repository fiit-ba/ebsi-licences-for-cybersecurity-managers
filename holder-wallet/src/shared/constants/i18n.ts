/**
 * Language configuration for the Professional License Registry pilot.
 *
 * The upstream atest wallet ships Spanish only. This deployment serves
 * Slovak holders first and is meant to be international later, so it offers
 * Slovak, the default, and English; the Spanish strings are removed. Every
 * bundle's keys come from its Slovak strings, and each English bundle is typed
 * against them, so a missing string is a type error rather than a raw key or a
 * foreign word on screen. The holder switches language in the app
 * (components/LanguageToggle); the choice is kept on the device
 * (services/Language.ts).
 */
export const DEFAULT_LANGUAGE = 'sk'

export const FALLBACK_LANGUAGE = 'sk'

export const SUPPORTED_LANGUAGES = ['sk', 'en'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/** Each language under its own name, as a switch shows it. */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  sk: 'Slovenčina',
  en: 'English',
}
