import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '@shared/constants/i18n'

/** Configures Slovak as the default Wallet language and English as the alternative. */
i18n.use(initReactI18next).init({
  compatibilityJSON: 'v3',
  lng: DEFAULT_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  keySeparator: false,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
