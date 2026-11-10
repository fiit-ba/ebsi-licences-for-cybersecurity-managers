import { useContext, useEffect, useState } from 'react'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { MessageContext } from '@app/context/UserMessage.context'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { getDidList, resolveKeychainDeferredCredentials } from '@infrastructure/persistence/keychain'
import { checkMailbox } from '@infrastructure/identity/lacchain/checkMailbox'
import { refreshStoredStatuses } from '@infrastructure/openid/checkRevocation'
import ButtonMailboxI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { ButtonMailboxProps, ButtonMailboxViewProps } from './component.types'

const useButtonMailbox = (props: ButtonMailboxProps): ButtonMailboxViewProps => {
  const bundle = 'ButtonMailbox'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const [isLoading, setIsLoading] = useState(false)
  const [isLacchainDid, setIsLacchainDid] = useState<boolean>()
  const navigation = useNavigation()
  const { showMessage } = useContext(MessageContext)

  useEffect(() => {
    void getDidList().then((dids: any[]) => setIsLacchainDid(dids.some((did) => did?.did?.startsWith('did:lac'))))
  }, [])

  const refresh = async () => {
    setIsLoading(true)
    const unlockedAt = WalletLock.current()
    // The list is current only if every step reached its source: offline, the
    // certificates keep their last known status and the holder is told so.
    let complete = true
    try {
      await resolveKeychainDeferredCredentials()
      if (isLacchainDid) await checkMailbox()
    } catch (error) {
      complete = false
      console.error('Error checking mailbox/getting deferred Credential:', error)
    } finally {
      try {
        const { unchecked } = await refreshStoredStatuses({ forceAfterCurrent: true })
        if (unchecked > 0) complete = false
      } catch (error) {
        complete = false
        console.warn("[wallet] the certificates' status could not be refreshed:", error)
      }
      props.onUpdated?.()
      showMessage(
        complete
          ? { content: t(ButtonMailboxI18nKeys.BUTTON_MAILBOX_SUCCESS), type: 'success' }
          : { content: t(ButtonMailboxI18nKeys.BUTTON_MAILBOX_INCOMPLETE), type: 'warning' },
      )
      // Navigating to the tabs under a sign-in screen would remove it: not when
      // the wallet locked while the refresh ran.
      if (WalletLock.stillUnlocked(unlockedAt)) navigation.navigate('Root', { screen: 'Credentials' })
      setIsLoading(false)
    }
  }

  return { actionWidth: props.actionWidth, isLoading, label: t(ButtonMailboxI18nKeys.BUTTON_MAILBOX), refresh }
}
export default useButtonMailbox
