import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import AccordionDetailI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { CredentialAccordionDetailProps, CredentialAccordionDetailViewProps } from './component.types'

const useCredentialAccordionDetail = (props: CredentialAccordionDetailProps): CredentialAccordionDetailViewProps => {
  const bundle = 'AccordionDetail'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const translatedStatus =
    props.status === 'Revoked'
      ? t(AccordionDetailI18nKeys.REVOKED)
      : props.status === 'Suspended'
        ? t(AccordionDetailI18nKeys.SUSPENDED)
        : t(AccordionDetailI18nKeys.VALID)
  return {
    ...props,
    t,
    translatedStatus: String(translatedStatus ?? t(AccordionDetailI18nKeys.UNDETERMINED)),
    mutedColor: getThemeColor(ColorKeys.mutedText),
    errorColor: getThemeColor(ColorKeys.error),
  }
}
export default useCredentialAccordionDetail
