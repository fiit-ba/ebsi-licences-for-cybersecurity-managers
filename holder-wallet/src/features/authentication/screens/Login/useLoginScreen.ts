import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, Keyboard, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { SessionPin } from '@infrastructure/security/SessionPin'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { BRAND } from '@shared/constants/brand'
import { inLanguage } from '@app/localization/Language'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { checkPin, getKeychainDataObject } from '@infrastructure/persistence/keychain'
import { executeCallbackFunction } from '@shared/utils/storeCallback'
import useEbsiDid from '@shared/hooks/useEbsiDid'
import { refreshStoredStatuses } from '@infrastructure/openid/checkRevocation'
import { resumeBackups } from '@infrastructure/backup'
import {
  Organization,
  ProfileKind,
  activeProfile,
  checkOrganizationPin,
  currentOrganization,
  deleteOrganizationProfile,
  openProfile,
} from '@infrastructure/organization/OrganizationService'
import RegisterI18nKeys from './i18n/keys'
import { LoginScreenProps, LoginScreenViewProps } from './screen.types'

const useLoginScreen = ({ route, navigation }: LoginScreenProps): LoginScreenViewProps => {
  const { t } = useTranslation(SCREEN.Login)
  const ensureEbsiDid = useEbsiDid()
  const { callback, locked } = route.params ?? {}
  const { showMessage } = useContext(MessageContext)
  const [organization, setOrganization] = useState<Organization | null>(currentOrganization())
  const [isLoading, setIsLoading] = useState(false)
  const [pin, setPinState] = useState('')
  const openedAs = useRef<ProfileKind | undefined>(undefined)
  const insets = useSafeAreaInsets()
  const compact = useWindowDimensions().height < 700

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        const back = event.data.action.type === 'GO_BACK' || event.data.action.type === 'POP'
        if (!locked || !back) return
        event.preventDefault()
        BackHandler.exitApp()
      }),
    [navigation, locked],
  )

  useFocusEffect(
    useCallback(() => {
      if (openedAs.current === undefined) openedAs.current = activeProfile()
      setOrganization(currentOrganization())
    }, []),
  )

  const switchTo = async (kind: ProfileKind) => {
    if (!(await openProfile(kind))) {
      navigation.navigate(kind === 'holder' ? 'Register' : 'Organization')
      return
    }
    setOrganization(currentOrganization())
    setPinState('')
  }

  useEffect(() => {
    ;(async () => {
      if (activeProfile() === 'organization') return
      if (!(await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED))) {
        if (await openProfile('organization')) {
          setOrganization(currentOrganization())
          return
        }
        showMessage({ content: t(RegisterI18nKeys.NO_WALLET), type: 'warning' })
        navigation.replace('Register')
      }
    })()
  }, [])

  useEffect(() => {
    if (!callback || activeProfile() !== 'organization') return
    ;(async () => {
      if (await openProfile('holder')) setOrganization(null)
      else {
        showMessage({ content: t(RegisterI18nKeys.LINK_NEEDS_HOLDER), type: 'warning' })
        navigation.setParams({ callback: undefined })
      }
    })()
  }, [callback])

  const goToRegister = async () => {
    if (!(await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED))) return navigation.navigate('Register')
    Alert.alert(String(t(RegisterI18nKeys.REPLACE_TITLE)), String(t(RegisterI18nKeys.REPLACE_TEXT)), [
      { text: String(t(RegisterI18nKeys.CANCEL)), style: 'cancel' },
      {
        text: String(t(RegisterI18nKeys.REPLACE_CONFIRM)),
        style: 'destructive',
        onPress: () => navigation.navigate('Register'),
      },
    ])
  }

  const openTabs = () => {
    const { routes, index } = navigation.getState()
    const wasSignedIn = routes.slice(0, index).some((below) => below.name === 'Root')
    const switched = openedAs.current !== undefined && openedAs.current !== activeProfile()
    if (wasSignedIn && switched) navigation.reset({ index: 0, routes: [{ name: 'Root' }] })
    else if (wasSignedIn) navigation.navigate('Root')
    else navigation.replace('Root')
  }
  const showError = () => {
    showMessage({ content: t(RegisterI18nKeys.ERROR), type: 'error' })
    setPinState('')
    setIsLoading(false)
  }
  const login = async () => {
    Keyboard.dismiss()
    const unlockedAt = WalletLock.current()
    // A link's flow (a presentation, an issuance) can outlast this session: when
    // the wallet locked meanwhile (the app went to the background), the sign-in
    // screen stays and the tabs open only after the PIN again.
    const open = () => {
      if (WalletLock.stillUnlocked(unlockedAt)) openTabs()
    }
    const hasEbsiDid = !!(await getKeychainDataObject())?.did?.ebsi
    SessionPin.set(pin)
    setPinState('')
    if (hasEbsiDid || (await ensureEbsiDid())) {
      void refreshStoredStatuses().catch((error) =>
        console.warn("[wallet] the certificates' status could not be refreshed:", error),
      )
      void resumeBackups()
      try {
        if (callback) {
          navigation.setParams({ callback: undefined })
          await executeCallbackFunction(callback.id, callback.params)
          if (navigation.isFocused()) open()
        } else open()
      } catch {
        if (navigation.isFocused()) open()
      }
    }
    setPinState('')
    setIsLoading(false)
  }
  const loginOrganization = () => {
    Keyboard.dismiss()
    setPinState('')
    openTabs()
    setIsLoading(false)
  }
  const unlock = async () => {
    if (organization?.revoked) return
    setIsLoading(true)
    if (organization) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      checkOrganizationPin(pin) ? loginOrganization() : showError()
    } else (await checkPin(pin)) ? await login() : showError()
  }
  const unlockHolder = async () => {
    setIsLoading(true)
    ;(await checkPin(pin)) ? await login() : showError()
  }
  const removeOrganization = () => {
    Alert.alert(String(t(RegisterI18nKeys.REMOVE_TITLE)), String(t(RegisterI18nKeys.REMOVE_TEXT)), [
      { text: String(t(RegisterI18nKeys.CANCEL)), style: 'cancel' },
      {
        text: String(t(RegisterI18nKeys.REMOVE_CONFIRM)),
        style: 'destructive',
        onPress: async () => {
          await deleteOrganizationProfile()
          setOrganization(currentOrganization())
          setPinState('')
          if (!(await openProfile('holder'))) navigation.replace('OnBoarding')
        },
      },
    ])
  }

  return {
    organization,
    pin,
    isLoading,
    compact,
    insets,
    tagline: inLanguage({ sk: BRAND.TAGLINE, en: BRAND.TAGLINE_EN }),
    placeholderColor: getThemeColor(ColorKeys.placeholder),
    t,
    setPin: (value) => setPinState(value.replace(/[^0-9]/g, '')),
    switchTo,
    goToRegister,
    goToVerify: () => navigation.navigate('Verify'),
    unlock,
    unlockHolder,
    removeOrganization,
  }
}

export default useLoginScreen
