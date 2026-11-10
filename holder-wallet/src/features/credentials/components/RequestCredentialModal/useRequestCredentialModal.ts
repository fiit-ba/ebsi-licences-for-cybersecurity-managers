import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { filterCredentialType } from '@infrastructure/openid/utils'
import requestCredentialModalI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { RequestCredentialModalProps, RequestCredentialModalViewProps } from './component.types'

const useRequestCredentialModal = (props: RequestCredentialModalProps): RequestCredentialModalViewProps => {
  const [data, setData] = useState('')
  const bundle = 'RequestCredentialModal'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const trustedFramework =
    props.modalProps.trustedFramework === 'epic' ? 'Alastria epic' : props.modalProps.trustedFramework
  const credentialParams = {
    [t(requestCredentialModalI18nKeys.ENTITY)]: props.modalProps?.entity,
    [t(requestCredentialModalI18nKeys.NETWORK)]: trustedFramework.toUpperCase(),
  }
  const dropdownItems = props.modalProps.availableCredentials.map((item: { types: string[] }) => {
    const filteredTypes = filterCredentialType(item.types) ?? ''
    return { label: filteredTypes.pop() ?? '', value: JSON.stringify(item) }
  })
  const accept = () => {
    if (data) {
      try {
        props.onAccept?.(JSON.parse(data))
      } catch (error) {
        console.error('Error parsing data:', error)
      }
    } else {
      props.onCancel?.()
    }
  }
  return {
    title: t(requestCredentialModalI18nKeys.TITLE),
    description: t(requestCredentialModalI18nKeys.DESCRIPTION),
    credentialRequestDescription: t(requestCredentialModalI18nKeys.CREDENTIAL_REQUEST_DESCRIPTION),
    credentialParams,
    dropdownItems,
    dropdownPlaceholder: String(t(requestCredentialModalI18nKeys.SELECT_PLACEHOLDER)),
    buttonText: t(data ? requestCredentialModalI18nKeys.REQUEST : requestCredentialModalI18nKeys.CANCEL),
    close: () => props.onCancel?.(),
    setData,
    accept,
  }
}
export default useRequestCredentialModal
