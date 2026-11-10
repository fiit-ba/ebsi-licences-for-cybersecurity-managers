import { useCallback, useRef } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { getPresentationList } from '@infrastructure/persistence/keychain'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import PresentationsI18nKeys from './i18n/keys'
import { PresentationsScreenProps, PresentationsScreenViewProps } from './screen.types'

const usePresentationsScreen = ({ navigation }: PresentationsScreenProps): PresentationsScreenViewProps => {
  const { t } = useTranslation(SCREEN.Presentations)
  const childRef = useRef<StateWrapperRef>(null)

  useFocusEffect(
    useCallback(() => {
      childRef.current?.reload?.({ silent: true })
    }, []),
  )

  return {
    childRef,
    loadPresentations: getPresentationList,
    placeholderTitle: t(PresentationsI18nKeys.PLACEHOLDER_TITLE),
    placeholderText: t(PresentationsI18nKeys.PLACEHOLDER_TEXT),
    scanQrLabel: t(PresentationsI18nKeys.SCAN_QR),
    openScanner: () => navigation.navigate('QrReader', {}),
  }
}

export default usePresentationsScreen
