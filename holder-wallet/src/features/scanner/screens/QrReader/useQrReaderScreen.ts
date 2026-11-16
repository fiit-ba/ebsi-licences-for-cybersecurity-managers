import { useContext, useEffect, useState } from 'react'
import { BarcodeScanningResult, Camera } from 'expo-camera'
import { CommonActions } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { useMatchingID } from '@infrastructure/identity/lacchain/didMatch'
import { useOpenId } from '@app/openid/useOpenId'
import { isInvitation } from '@infrastructure/exchange/protocol'
import { toUserMessage } from '@app/localization/i18n/describeError'
import qrReaderI18nKeys from './i18n/keys'
import { QrReaderScreenProps, QrReaderScreenViewProps } from './screen.types'

const useQrReaderScreen = (props: QrReaderScreenProps): QrReaderScreenViewProps => {
  const { handleCredentialOffer } = useOpenId()
  const { handleMatchingID } = useMatchingID()
  const { t } = useTranslation(SCREEN.QrReader)
  const [isLoading, setIsLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [scanned, setScanned] = useState(false)
  const { showMessage } = useContext(MessageContext)
  const { navigation, route } = props

  useEffect(() => {
    const initialize = async () => {
      const { status } = await Camera.getCameraPermissionsAsync()
      setHasPermission(status === 'granted')
      if (status === 'undetermined') {
        const requested = await Camera.requestCameraPermissionsAsync()
        setHasPermission(requested.status === 'granted')
      }
      setIsLoading(false)
    }
    void initialize()
  }, [])

  const handleBarCodeScanned = async ({ data }: BarcodeScanningResult) => {
    if (scanned) return
    setScanned(true)
    setIsReading(true)
    try {
      if (isInvitation(data)) {
        navigation.replace('VerifyOffline', { invitation: data })
      } else if (data.startsWith('openid')) {
        const result = await handleCredentialOffer(data)
        if (!result) setScanned(false)
      } else if (data.startsWith('matching-id')) {
        const unlockedAt = WalletLock.current()
        await handleMatchingID(data)
        showMessage({ content: t(qrReaderI18nKeys.SUCCESS_ASOCIATE_IDENTIFIER), type: 'success' })
        // Not past the sign-in screen if the wallet locked meanwhile.
        if (WalletLock.stillUnlocked(unlockedAt))
          navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Root' }] }))
      } else {
        try {
          const result = await handleCredentialOffer(JSON.stringify(JSON.parse(data)))
          if (!result) setScanned(false)
        } catch {
          showMessage({ content: t(qrReaderI18nKeys.ERROR), type: 'error' })
          setScanned(false)
        }
      }
    } catch (error) {
      showMessage({ content: toUserMessage(error), type: 'error' })
      setScanned(false)
    } finally {
      setIsReading(false)
    }
  }

  return {
    isLoading,
    hasPermission,
    isReading,
    loadingColor: getThemeColor(ColorKeys.primary),
    subtitle: t(qrReaderI18nKeys.SCAN_QR, { issuer: route.params?.issuer || t(qrReaderI18nKeys.ISSUER) }),
    permissionMessage: t(qrReaderI18nKeys.PERMISSIONS_MESSAGE),
    navigation: props.navigation,
    handleBarCodeScanned,
  }
}

export default useQrReaderScreen
