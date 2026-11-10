import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import RequestPreauthorizeUserPinModalI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { RequestPreauthorizeUserPinModalProps, RequestPreauthorizeUserPinModalViewProps } from './component.types'

const useRequestPreauthorizeUserPinModal = (
  props: RequestPreauthorizeUserPinModalProps,
): RequestPreauthorizeUserPinModalViewProps => {
  const [data, setData] = useState('')
  const [isPinFocused, setIsPinFocused] = useState(false)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const bundle = 'RequestPreauthorizeUserPinModal'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setIsKeyboardVisible(true),
    )
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setIsKeyboardVisible(false),
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return {
    data,
    isPinFocused,
    isKeyboardVisible,
    title: t(RequestPreauthorizeUserPinModalI18nKeys.TITLE),
    description: t(RequestPreauthorizeUserPinModalI18nKeys.DESCRIPTION),
    pinLabel: t(RequestPreauthorizeUserPinModalI18nKeys.PIN_LABEL),
    requestLabel: t(RequestPreauthorizeUserPinModalI18nKeys.REQUEST),
    close: () => props.onCancel?.(),
    focus: () => setIsPinFocused(true),
    blur: () => setIsPinFocused(false),
    changePin: (value) => setData(value.replace(/[^0-9]/g, '')),
    accept: () => {
      Keyboard.dismiss()
      props.onAccept?.(data)
    },
  }
}
export default useRequestPreauthorizeUserPinModal
