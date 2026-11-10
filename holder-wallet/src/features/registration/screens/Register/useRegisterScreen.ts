import { useContext, useEffect, useState } from 'react'
import { Keyboard } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getAppColorScheme, getThemeColor } from '@shared/constants/Colors'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { createEncryptedWallet } from '@infrastructure/wallet/wallet.service'
import { hasOrganizationProfile, openProfile } from '@infrastructure/organization/OrganizationService'
import TermsModal from '@shared/components/TermsModal'
import useModal from '@shared/hooks/useModal'
import RegisterI18nKeys from './i18n/keys'
import { RegisterScreenProps, RegisterScreenViewProps } from './screen.types'

const useRegisterScreen = ({ navigation }: RegisterScreenProps): RegisterScreenViewProps => {
  const { showMessage } = useContext(MessageContext)
  const { t } = useTranslation(SCREEN.Register)
  const [firstPin, setFirstPinState] = useState('')
  const [secondPin, setSecondPinState] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTermsChecked, setIsTermsChecked] = useState(false)
  const [hasWallet, setHasWallet] = useState(false)
  const { showModal } = useModal()
  const pinsMatch = firstPin !== '' && secondPin !== '' && firstPin === secondPin

  useEffect(() => {
    LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED).then((holder) =>
      setHasWallet(holder || hasOrganizationProfile()),
    )
  }, [])

  const createWallet = async () => {
    Keyboard.dismiss()
    try {
      const data = await createEncryptedWallet(firstPin)
      showMessage({ content: t(RegisterI18nKeys.MESSAGE_SUCCESS_WALLET_CREATION), type: 'success' })
      setTimeout(() => {
        setIsLoading(false)
        navigation.replace('SecurityPhrase', { mneumonic: data.mnemonicPhrase, derivationPath: data.derivationPath })
      }, 1000)
    } catch (error) {
      showMessage({ content: t(RegisterI18nKeys.MESSAGE_ERROR_WALLET_CREATION), type: 'error' })
      setIsLoading(false)
      console.error('error', error)
    }
  }

  useEffect(() => {
    if (!isLoading) return
    if (firstPin.length < 4) {
      showMessage({ content: t(RegisterI18nKeys.ERROR_PIN_LENGTH), type: 'error' })
      setIsLoading(false)
    } else setTimeout(() => void createWallet(), 500)
  }, [isLoading])

  const openTerms = () => showModal?.({ Component: TermsModal })
  const digitsOnly = (setter: (value: string) => void) => (value: string) => setter(value.replace(/[^0-9]/g, ''))
  return {
    firstPin,
    secondPin,
    isLoading,
    isPinFilled: !pinsMatch,
    isTermsChecked,
    hasWallet,
    errorMessage: firstPin === '' || secondPin === '' || pinsMatch ? '' : t(RegisterI18nKeys.ERROR),
    statusBarStyle: getAppColorScheme() === 'dark' ? 'light' : 'dark',
    textColor: getThemeColor(ColorKeys.text),
    primaryColor: getThemeColor(ColorKeys.primary),
    labels: {
      login: t(RegisterI18nKeys.LOGIN),
      title: t(RegisterI18nKeys.TITLE),
      subtitle: t(RegisterI18nKeys.SUBTITLE),
      pin: t(RegisterI18nKeys.PIN) || '',
      secondPin: t(RegisterI18nKeys.SECOND_PIN) || '',
      conditions: t(RegisterI18nKeys.CONDITIONS),
      loading: t('LOADING'),
      button: t('BUTTON'),
      restore: t(RegisterI18nKeys.RESTORE),
      or: t(RegisterI18nKeys.OR),
      verify: t(RegisterI18nKeys.VERIFY_ONLY),
      verifyHint: t(RegisterI18nKeys.VERIFY_HINT),
      organization: t(RegisterI18nKeys.ORG_ENTRY),
    },
    setFirstPin: digitsOnly(setFirstPinState),
    setSecondPin: digitsOnly(setSecondPinState),
    toggleTerms: () => {
      setIsTermsChecked((checked) => !checked)
      if (!isTermsChecked) openTerms()
    },
    openTerms: () => {
      openTerms()
      setIsTermsChecked(true)
    },
    submit: () => setIsLoading(true),
    goLogin: () => navigation.navigate('Login'),
    goRestore: () => navigation.navigate('Restore'),
    goVerify: () => navigation.navigate('Verify'),
    goOrganization: async () => navigation.navigate((await openProfile('organization')) ? 'Login' : 'Organization'),
  }
}

export default useRegisterScreen
