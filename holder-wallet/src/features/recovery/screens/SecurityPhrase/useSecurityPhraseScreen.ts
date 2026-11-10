import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { getAppColorScheme } from '@shared/constants/Colors'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import SecurityPhraseI18nKeys from './i18n/keys'
import { SecurityPhraseScreenProps, SecurityPhraseScreenViewProps } from './screen.types'

const useSecurityPhraseScreen = ({ route, navigation }: SecurityPhraseScreenProps): SecurityPhraseScreenViewProps => {
  const { t } = useTranslation(SCREEN.SecurityPhrase)
  const { mneumonic = '', derivationPath = '' } = route.params || {}
  const [seedPhrase, setSeedPhrase] = useState('')
  const [isSeedBlur, setIsSeedBlur] = useState(true)

  useEffect(() => {
    setSeedPhrase(mneumonic)
  }, [mneumonic])

  const goBack = async () => {
    const isWalletCreated = await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED)
    navigation.navigate(isWalletCreated ? 'Login' : 'Register')
  }

  return {
    seedPhrase,
    isSeedBlur,
    statusBarStyle: getAppColorScheme() === 'dark' ? 'light' : 'dark',
    goBack,
    toggleSeedVisibility: () => setIsSeedBlur((isHidden) => !isHidden),
    confirmPhrase: () => navigation.navigate('SecurityPhraseConfirm', { mneumonic, derivationPath }),
    labels: {
      goBack: t(SecurityPhraseI18nKeys.GO_BACK),
      title: t(SecurityPhraseI18nKeys.TITLE),
      subtitle: t(SecurityPhraseI18nKeys.SUBTITLE),
      hiddenTitle: t(SecurityPhraseI18nKeys.HIDDEN_TITLE),
      longPress: t(SecurityPhraseI18nKeys.LONG_PRESS),
      button: t(SecurityPhraseI18nKeys.BUTTON),
    },
  }
}

export default useSecurityPhraseScreen
