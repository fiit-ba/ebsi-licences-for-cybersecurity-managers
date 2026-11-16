import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import useEbsiDid from '@shared/hooks/useEbsiDid'
import { WalletLock } from '@infrastructure/security/WalletLock'
import DerivationPathI18nKeys from './i18n/keys'
import { DerivationPathScreenProps, DerivationPathScreenViewProps } from './screen.types'

const useDerivationPathScreen = ({ route, navigation }: DerivationPathScreenProps): DerivationPathScreenViewProps => {
  const { t } = useTranslation(SCREEN.DerivationPath)
  const [isSeedBlur, setIsSeedBlur] = useState(true)
  const [isCreatingDid, setIsCreatingDid] = useState(false)
  const ensureEbsiDid = useEbsiDid()

  const finish = useCallback(async () => {
    setIsCreatingDid(true)
    const unlockedAt = WalletLock.current()
    if (await ensureEbsiDid()) {
      // Locked while the DID was created (the app went to the background): the
      // new wallet opens at its sign-in screen, with the PIN just chosen.
      navigation.reset({ index: 0, routes: [{ name: WalletLock.stillUnlocked(unlockedAt) ? 'Root' : 'Login' }] })
    } else {
      setIsCreatingDid(false)
    }
  }, [ensureEbsiDid, navigation])

  return {
    derivationPath: route.params!.derivationPath,
    isSeedBlur,
    isCreatingDid,
    goBack: () => navigation.pop(),
    toggleSeedVisibility: () => setIsSeedBlur((isHidden) => !isHidden),
    finish,
    labels: {
      goBack: t(DerivationPathI18nKeys.GO_BACK),
      title: t(DerivationPathI18nKeys.TITLE),
      subtitle: t(DerivationPathI18nKeys.SUBTITLE),
      hiddenTitle: t(DerivationPathI18nKeys.HIDDEN_TITLE),
      longPress: t(DerivationPathI18nKeys.LONG_PRESS),
      button: t(DerivationPathI18nKeys.BUTTON),
    },
  }
}

export default useDerivationPathScreen
