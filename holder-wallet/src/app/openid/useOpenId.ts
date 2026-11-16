// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import { useContext } from 'react'
import { ModalContextProps } from '@app/context/Modal.context'
import { MessageContext } from '@app/context/UserMessage.context'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { extractCredentialOfferUri } from '@shared/utils/url'
import { CredentialOffer, OpenIdConfiguration, OpenIdCredentialIssuer } from '@infrastructure/openid/types'
import { CommonActions, useNavigation } from '@react-navigation/native'
import { WalletLock } from '@infrastructure/security/WalletLock'
import useModal from '@shared/hooks/useModal'
import OpenIdService, { parseQuery } from '@infrastructure/openid/OpenIdService'
import { requestCredential } from './requestCredential'
// Removes the Spanish strings: the wallet offers Slovak and English.
import { issuePresentation } from './issuePresentation'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@app/localization/i18n/sk'
import localeEN from '@app/localization/i18n/en'
// Errors shown in Slovak.
import { toUserMessage } from '@app/localization/i18n/describeError'
import openIdI18nKeys from '@app/localization/i18n/keys'

export const useOpenId = () => {
  const bundleName = 'openId'
  // Registers the Slovak strings and the English ones, for the language
  // switch; Spanish is no longer offered.
  i18next.addResourceBundle('sk', bundleName, localeSK)
  i18next.addResourceBundle('en', bundleName, localeEN)
  const { t } = useTranslation(bundleName)
  const { showModal } = useModal() as ModalContextProps
  const { showMessage } = useContext(MessageContext)
  const navigation = useNavigation()

  // Back to the tabs after the flow - unless the wallet locked while it ran: the
  // sign-in screen over them stays until the PIN is entered again.
  const openRootTab = (screen: 'Credentials' | 'Presentations', unlockedAt: number) => {
    if (!WalletLock.stillUnlocked(unlockedAt)) return
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Root', params: { screen } }],
      }),
    )
  }

  // A presentation request (OpenID4VP 1.0: `openid4vp://?client_id=…&request_uri=…`)
  // goes to the presentation flow; a credential offer (OpenID4VCI 1.0, by value or
  // by reference) to issuance.
  const handleCredentialOffer = async (data: string): Promise<'credential' | 'presentation' | false> => {
    const unlockedAt = WalletLock.current()
    let content
    try {
      const params = parseQuery(data)
      if (/^openid4vp:/i.test(data.trim()) || (params.request_uri && params.client_id)) {
        content = await issuePresentation(data.trim(), { t, showModal })
        showMessage({ content, type: 'success' })
        openRootTab('Presentations', unlockedAt)
        return 'presentation'
      }
      let credentialOffer: CredentialOffer
      try {
        credentialOffer = JSON.parse(data)
      } catch {
        // By value in the URI's credential_offer, or by reference in its credential_offer_uri.
        credentialOffer = params.credential_offer
          ? JSON.parse(params.credential_offer)
          : await OpenIdService.getCredentialOffer(params.credential_offer_uri ?? extractCredentialOfferUri(data))
      }
      if (!credentialOffer?.credential_issuer || !Array.isArray(credentialOffer.credential_configuration_ids))
        throw new Error(openIdI18nKeys.ERROR_CREDENTIAL_OFFER)
      const openIdCredentialIssuer: OpenIdCredentialIssuer = await OpenIdService.getOpenIdCredentialIssuer(
        credentialOffer.credential_issuer,
      )
      const authorizationServer =
        credentialOffer.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.authorization_server ??
        credentialOffer.grants?.authorization_code?.authorization_server ??
        openIdCredentialIssuer.authorization_servers?.[0] ??
        openIdCredentialIssuer.credential_issuer
      const openIdConfiguration: OpenIdConfiguration = await OpenIdService.getOpenIdConfiguration(authorizationServer)

      content = await requestCredential(credentialOffer, openIdCredentialIssuer, openIdConfiguration, {
        t,
        showModal,
      })
      showMessage({ content, type: 'success' })
      openRootTab('Credentials', unlockedAt)
      return 'credential'
    } catch (error: any) {
      // Always Slovak: a message of ours as it is, anything else described
      // (app/localization/i18n/describeError.ts).
      content = toUserMessage(error)
      showMessage({ content, type: 'error' })
      return false
    }
  }
  return { handleCredentialOffer }
}
