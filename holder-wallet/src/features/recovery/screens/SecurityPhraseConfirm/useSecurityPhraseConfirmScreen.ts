import { useCallback, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { shuffleArray } from '@shared/utils/shuffleArray'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { setActiveProfile } from '@infrastructure/organization/OrganizationService'
import SecurityPhraseConfirmI18nKeys from './i18n/keys'
import { SecurityPhraseConfirmScreenProps, SecurityPhraseConfirmScreenViewProps } from './screen.types'

const useSecurityPhraseConfirmScreen = ({
  route,
  navigation,
}: SecurityPhraseConfirmScreenProps): SecurityPhraseConfirmScreenViewProps => {
  const { t } = useTranslation(SCREEN.SecurityPhraseConfirm)
  const { showMessage } = useContext(MessageContext)
  const { mneumonic = '', derivationPath = '' } = route.params || {}
  const originalSeed = mneumonic.split(' ')
  const [seedPhrase, setSeedPhrase] = useState<string[]>(originalSeed)
  const [showedPhrase, setShowedPhrase] = useState<string[]>([])

  const resetSeeds = useCallback(() => {
    setSeedPhrase(shuffleArray(mneumonic.split(' ')))
    setShowedPhrase([])
  }, [mneumonic])

  useEffect(() => {
    resetSeeds()
  }, [resetSeeds])

  const selectWord = (word: string) => {
    setShowedPhrase((current) => [...current, word])
    setSeedPhrase((current) =>
      current.filter((item, index, all) => item !== word || index !== all.findIndex((candidate) => candidate === word)),
    )
  }

  const confirmSeeds = async () => {
    if (JSON.stringify(originalSeed) !== JSON.stringify(showedPhrase)) {
      showMessage({ content: t(SecurityPhraseConfirmI18nKeys.ERROR), type: 'error' })
      return
    }
    await LocalStorageService.storeBool(STORAGE_KEYS.IS_WALLET_CREATED, true)
    await setActiveProfile('holder')
    navigation.navigate('DerivationPath', { derivationPath })
    resetSeeds()
  }

  return {
    seedPhrase,
    showedPhrase,
    goBack: () => navigation.pop(),
    selectWord,
    resetSeeds,
    confirmSeeds,
    labels: {
      goBack: t(SecurityPhraseConfirmI18nKeys.GO_BACK),
      title: t(SecurityPhraseConfirmI18nKeys.CONFIRM_TITLE),
      inputLabel: t(SecurityPhraseConfirmI18nKeys.INPUT_LABEL),
      inputPlaceholder: t(SecurityPhraseConfirmI18nKeys.INPUT_PLACEHOLDER),
      reset: t(SecurityPhraseConfirmI18nKeys.RESET_BUTTON),
      confirm: t(SecurityPhraseConfirmI18nKeys.CONFIRM_BUTTON),
    },
  }
}

export default useSecurityPhraseConfirmScreen
