import { useCallback, useRef } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { activeProfile, organizationLogs } from '@infrastructure/organization/OrganizationService'
import { SCREEN } from '@shared/constants/screens'
import { checkAndLogExpiredCredentials, getActionLogs } from '@infrastructure/persistence/keychain'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import HistoricalI18nKeys from './i18n/keys'
import { HistoricalScreenProps, HistoricalScreenViewProps } from './screen.types'

const useHistoricalScreen = (_props: HistoricalScreenProps): HistoricalScreenViewProps => {
  const { t } = useTranslation(SCREEN.Historical)
  const childRef = useRef<StateWrapperRef>(null)

  useFocusEffect(
    useCallback(() => {
      childRef.current?.reload?.({ silent: true })
    }, []),
  )

  const loadHistory = useCallback(async () => {
    if (activeProfile() === 'organization') return organizationLogs()
    await checkAndLogExpiredCredentials().catch(() => {})
    return getActionLogs()
  }, [])

  return {
    childRef,
    loadHistory,
    placeholderTitle: t(HistoricalI18nKeys.PLACEHOLDER_TITLE),
    placeholderText: t(HistoricalI18nKeys.PLACEHOLDER_TEXT),
  }
}

export default useHistoricalScreen
