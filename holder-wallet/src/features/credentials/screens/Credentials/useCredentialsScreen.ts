import { useCallback, useEffect, useRef } from 'react'
import { useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { getCredentialsList } from '@infrastructure/persistence/keychain'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import { refreshStoredStatuses } from '@infrastructure/openid/checkRevocation'
import { onWalletChanged } from '@infrastructure/backup/changes'
import CredentialsI18nKeys from './i18n/keys'
import { CredentialsScreenProps, CredentialsScreenViewProps } from './screen.types'

const useCredentialsScreen = ({ navigation }: CredentialsScreenProps): CredentialsScreenViewProps => {
  const { t } = useTranslation(SCREEN.Credentials)
  const { width, fontScale } = useWindowDimensions()
  const stackActions = width < 375 || fontScale > 1.15
  const stackedWidth = Math.min(width - 20, Math.round(240 * Math.max(1, fontScale)))
  const scanActionWidth = stackActions ? stackedWidth : 144
  const refreshActionWidth = stackActions ? stackedWidth : Math.min(240, width - 28 - scanActionWidth)
  const childRef = useRef<StateWrapperRef>(null)
  const hasFocusedRef = useRef(false)
  const reloadCredentials = useCallback(() => childRef.current?.reload?.({ silent: true }), [])

  useFocusEffect(
    useCallback(() => {
      let active = true
      if (hasFocusedRef.current) reloadCredentials()
      hasFocusedRef.current = true
      void refreshStoredStatuses()
        .catch((error) => console.warn("[wallet] the certificates' status could not be refreshed:", error))
        .finally(() => {
          if (active) reloadCredentials()
        })
      return () => {
        active = false
      }
    }, [reloadCredentials]),
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = onWalletChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(reloadCredentials, 300)
    })
    return () => {
      stop()
      if (timer) clearTimeout(timer)
    }
  }, [reloadCredentials])

  return {
    childRef,
    stackActions,
    scanActionWidth,
    refreshActionWidth,
    primaryColor: getThemeColor(ColorKeys.primary),
    loadCredentials: getCredentialsList,
    reloadCredentials,
    openScanner: () => navigation.navigate('QrReader', {}),
    openPresentation: () => navigation.navigate('Present'),
    placeholderTitle: t(CredentialsI18nKeys.PlACEHOLDER_TITLE),
    placeholderText: t(CredentialsI18nKeys.PlACEHOLDER_TEXT),
    presentLabel: t(CredentialsI18nKeys.BUTTON_PRESENT),
  }
}

export default useCredentialsScreen
