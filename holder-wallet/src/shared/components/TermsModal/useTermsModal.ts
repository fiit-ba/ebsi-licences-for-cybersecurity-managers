import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import termsModalI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { OPERATOR_TERMS } from './operator/terms'
import { inLanguage } from '@app/localization/Language'
import { TermsModalProps, TermsModalViewProps } from './component.types'

const paragraphsOf = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^[ \t]+/gm, '').trim())
    .filter(Boolean)

const useTermsModal = (props: TermsModalProps): TermsModalViewProps => {
  const bundle = 'TermsModal'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const operatorText = OPERATOR_TERMS ? inLanguage(OPERATOR_TERMS) : null

  return {
    title: t(termsModalI18nKeys.MODAL_TITLE),
    version: OPERATOR_TERMS?.version,
    paragraphs: paragraphsOf(operatorText ?? t(termsModalI18nKeys.TERMS_AND_CONDITIONS_CONTENT)),
    buttonText: props.modalProps?.buttonText ?? t(termsModalI18nKeys.MODAL_BUTTON),
    onClose: () => props.onCancel?.(),
  }
}
export default useTermsModal
