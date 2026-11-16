import { useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { Alert, Keyboard } from 'react-native'
import * as Network from 'expo-network'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getAppColorScheme, getThemeColor } from '@shared/constants/Colors'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { identityKeyOf, restoreWallet } from '@infrastructure/wallet/wallet.service'
import { isValidPhrase, normalizePhrase, unknownWords } from '@domain/identity/recovery'
import { BackupUnavailable, downloadBackup, markBackupReady, markRestoring, mergeBackup } from '@infrastructure/backup'
import { backupKeys } from '@infrastructure/backup/keys'
import { setActiveProfile } from '@infrastructure/organization/OrganizationService'
import { toUserMessage } from '@app/localization/i18n/describeError'
import useEbsiDid from '@shared/hooks/useEbsiDid'
import RestoreI18nKeys from './i18n/keys'
import { RestoreScreenProps, RestoreScreenViewProps } from './screen.types'

const isOffline = async (): Promise<boolean> => {
  const state = await Network.getNetworkStateAsync().catch(() => undefined)
  return state?.isConnected === false || state?.isInternetReachable === false
}

const useRestoreScreen = ({ navigation }: RestoreScreenProps): RestoreScreenViewProps => {
  const { t } = useTranslation(SCREEN.Restore)
  const { showMessage } = useContext(MessageContext)
  const ensureEbsiDid = useEbsiDid()
  const [phrase, setPhrase] = useState('')
  const [pin, setPinState] = useState('')
  const [secondPin, setSecondPinState] = useState('')
  const [busy, setBusy] = useState(false)
  const words = useMemo(() => normalizePhrase(phrase).split(' ').filter(Boolean), [phrase])
  const unknown = useMemo(() => unknownWords(phrase), [phrase])
  const phraseError = unknown.length
    ? t(RestoreI18nKeys.UNKNOWN_WORDS, { words: unknown.join(', ') })
    : words.length >= 12 && !isValidPhrase(phrase)
      ? t(RestoreI18nKeys.INVALID_PHRASE)
      : ''
  const pinError =
    pin && secondPin && pin !== secondPin
      ? t(RestoreI18nKeys.ERROR_PIN_MATCH)
      : pin && pin.length < 4
        ? t(RestoreI18nKeys.ERROR_PIN_LENGTH)
        : ''
  const ready = isValidPhrase(phrase) && pin.length >= 4 && pin === secondPin && !busy

  const restore = async () => {
    Keyboard.dismiss()
    setBusy(true)
    const unlockedAt = WalletLock.current()
    try {
      const backup = await downloadBackup(backupKeys(identityKeyOf(phrase)))
      await markRestoring()
      await restoreWallet(phrase, pin)
      await LocalStorageService.storeBool(STORAGE_KEYS.IS_WALLET_CREATED, true)
      await setActiveProfile('holder')
      if (!(await ensureEbsiDid())) return
      const count = backup ? await mergeBackup(backup) : 0
      await markBackupReady()
      showMessage({
        content: backup ? t(RestoreI18nKeys.RESTORED, { count }) : t(RestoreI18nKeys.RESTORED_NO_BACKUP),
        type: 'success',
      })
      // Locked while restoring (the app went to the background): the restored
      // wallet opens at its sign-in screen, with the PIN just chosen.
      navigation.reset({ index: 0, routes: [{ name: WalletLock.stillUnlocked(unlockedAt) ? 'Root' : 'Login' }] })
    } catch (error: any) {
      if (error instanceof BackupUnavailable) {
        console.warn('[wallet] the backup could not be fetched:', error.message)
        showMessage({
          content: t((await isOffline()) ? RestoreI18nKeys.OFFLINE : RestoreI18nKeys.UNAVAILABLE),
          type: 'error',
        })
        return
      }
      const key = String(error?.message ?? '')
      const content = key in RestoreI18nKeys ? t(key) : `${t(RestoreI18nKeys.ERROR)} ${toUserMessage(error)}`
      showMessage({ content, type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!(await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED))) {
      await restore()
      return
    }
    Alert.alert(String(t(RestoreI18nKeys.REPLACE_TITLE)), String(t(RestoreI18nKeys.REPLACE_TEXT)), [
      { text: String(t(RestoreI18nKeys.CANCEL)), style: 'cancel' },
      { text: String(t(RestoreI18nKeys.REPLACE_CONFIRM)), style: 'destructive', onPress: restore },
    ])
  }

  const digitsOnly = (setter: (value: string) => void) => (value: string) => setter(value.replace(/[^0-9]/g, ''))

  return {
    phrase,
    pin,
    secondPin,
    busy,
    ready,
    wordCount: words.length,
    phraseError,
    pinError,
    statusBarStyle: getAppColorScheme() === 'dark' ? 'light' : 'dark',
    spinnerColor: getThemeColor(ColorKeys.text),
    goBack: () => navigation.goBack(),
    setPhrase,
    setPin: digitsOnly(setPinState),
    setSecondPin: digitsOnly(setSecondPinState),
    confirm,
    labels: {
      goBack: t(RestoreI18nKeys.GO_BACK),
      title: t(RestoreI18nKeys.TITLE),
      subtitle: t(RestoreI18nKeys.SUBTITLE),
      phrase: t(RestoreI18nKeys.PHRASE) || '',
      wordCount: t(RestoreI18nKeys.WORD_COUNT, { count: words.length }),
      pin: t(RestoreI18nKeys.PIN) || '',
      secondPin: t(RestoreI18nKeys.SECOND_PIN) || '',
      loading: t(RestoreI18nKeys.LOADING),
      button: t(RestoreI18nKeys.BUTTON),
    },
  }
}

export default useRestoreScreen
