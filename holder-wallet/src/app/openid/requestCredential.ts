// Collecting a certificate with OpenID for Verifiable Credential Issuance 1.0.
// The offer names the credentials by their configuration ids in the issuer's
// metadata; a pre-authorized code comes with a transaction code (tx_code) - the
// PIN the issuing body delivers separately - when the offer asks for one. The
// key proof names a c_nonce from the issuer's Nonce Endpoint, and the response
// carries the credentials (or a transaction id to collect them later).
// Removes getDid and getPrivateKey: the certificate is bound to the wallet's
// binding key with its issuer (bindingForIssuer, below).
import { saveCredential, saveDeferredCredential, savePresentation } from '@infrastructure/persistence/keychain'
import RequestCredentialModal from '@features/credentials/components/RequestCredentialModal'
import { decodeJwt } from 'jose'
import {
  CredentialOffer,
  OpenIdCredentialIssuer,
  OpenIdConfiguration,
  AuthorizationRequestResponse,
  AuthorizationResponse,
  TokenResponse,
  ModalType,
  DeferredCredential,
  OfferedCredential,
  GrantType,
  PresentationRequest,
} from '@infrastructure/openid/types'
import { createTokenResponse, getTrustedFrameworkFromDid } from '@infrastructure/openid/utils'
import { processAuthorizationResponse } from '@shared/utils/url'
import RequestPreauthorizeUserPinModal from '@features/credentials/components/RequestPreauthorizeUserPinModal'
import OpenIdService from '@infrastructure/openid/OpenIdService'
import openIdI18nKeys from '@app/localization/i18n/keys'
import { signJWT } from '@infrastructure/crypto/jwt'
import { generateCodeVerifierAndChallenge } from '@shared/utils/pkceGenerator'
// Removes the Alastria DID method import: credentials are requested for the
// EBSI DID only.
// What a certificate is bound to (design decisions D34).
import { bindingForIssuer } from '@infrastructure/identity/binding/binding.service'
import { presentFor } from './issuePresentation'

const PRE_AUTHORIZED: GrantType = 'urn:ietf:params:oauth:grant-type:pre-authorized_code'

/** The offered credentials, as the holder chooses among them: each configuration with its types. */
export const offeredCredentials = (offer: CredentialOffer, metadata: OpenIdCredentialIssuer): OfferedCredential[] =>
  (offer.credential_configuration_ids ?? [])
    .filter((id) => metadata.credential_configurations_supported?.[id])
    .map((id) => {
      const configuration = metadata.credential_configurations_supported[id]
      return { ...configuration, id, types: configuration.credential_definition?.type ?? [id] }
    })

export const requestCredential = async (
  credentialOffer: CredentialOffer,
  openIdCredentialIssuer: OpenIdCredentialIssuer,
  openIdConfiguration: OpenIdConfiguration,
  { t, showModal }: ModalType,
) => {
  if (!t) throw new Error('Error translating')
  // Not the wallet's DID, which never leaves the phone (design decisions D31), but
  // the binding key the wallet uses with this issuer, an EBSI did:key derived
  // from the phrase: the authorization request, the ID token, the proof and
  // the certificate name it, and it signs them (D34).
  const issuerUri = openIdCredentialIssuer.credential_issuer
  const { did: subjectDid, privateKey } = await bindingForIssuer(issuerUri)
  const preAuthorized = credentialOffer?.grants?.[PRE_AUTHORIZED]
  const available = offeredCredentials(credentialOffer, openIdCredentialIssuer)
  if (!available.length) throw new Error(openIdI18nKeys.ERROR_CREDENTIAL_OFFER)
  const trustedFramework = openIdConfiguration.subject_trust_frameworks_supported?.[0] ?? 'ebsi'

  const choose = () =>
    new Promise<OfferedCredential>((resolve, reject) =>
      showModal?.({
        Component: RequestCredentialModal,
        modalProps: { entity: issuerUri, trustedFramework, availableCredentials: available },
        onAccept: resolve,
        onCancel: () => reject(new Error(openIdI18nKeys.CANCEL)),
      }),
    )

  let message
  let presentation = false
  let signedPresentations: string[] = []

  let chosenCredential: OfferedCredential
  let tokenResponse: TokenResponse

  if (preAuthorized) {
    const preAuthorizedCode = preAuthorized['pre-authorized_code']
    if (!preAuthorizedCode) throw new Error(openIdI18nKeys.ERROR_PREAUTHORIZATION)

    // The PIN the issuing body delivered apart from the offer (tx_code).
    let txCode: string | undefined
    if (preAuthorized.tx_code) {
      txCode = await new Promise<string>((resolve, reject) =>
        showModal?.({
          Component: RequestPreauthorizeUserPinModal,
          modalProps: { txCode: preAuthorized.tx_code },
          onAccept: async (value: string) => {
            if (value.length === 0) reject(new Error(openIdI18nKeys.ERROR_NO_PIN))
            resolve(value)
          },
          onCancel: () => reject(new Error(openIdI18nKeys.CANCEL)),
        }),
      )
    }

    tokenResponse = await OpenIdService.sendTokenRequest(
      {
        grant_type: PRE_AUTHORIZED,
        'pre-authorized_code': preAuthorizedCode,
        ...(txCode != null && { tx_code: txCode }),
      },
      openIdConfiguration.token_endpoint,
    )
    if (!tokenResponse?.access_token) throw new Error(t(openIdI18nKeys.ERROR_PREAUTHORIZATION_PIN))

    chosenCredential = await choose()
  } else {
    // Authorization code flow: the issuer's authorization server asks for an ID
    // token or a presentation before it grants the code.
    const { verifier, challenge } = await generateCodeVerifierAndChallenge()
    chosenCredential = await choose()
    const authorizationRequestResponse: AuthorizationRequestResponse = await OpenIdService.sendAuthorizationRequest({
      issuerState: credentialOffer?.grants?.authorization_code?.issuer_state,
      subjectDid,
      challenge,
      authorizationEndpoint: openIdConfiguration?.authorization_endpoint,
      credentialConfigurationId: chosenCredential.id,
      locations: issuerUri,
      scope: openIdConfiguration.scopes_supported ?? ['openid'],
    })

    const requestToken = await OpenIdService.processTokenRequest(authorizationRequestResponse)
    const authorizationServer = openIdCredentialIssuer.authorization_servers?.[0] ?? issuerUri
    const { redirect_uri, state }: { redirect_uri: string; state?: string } = decodeJwt(requestToken) as any

    let response
    if (authorizationRequestResponse.response_type === 'id_token') {
      const { signedToken: idToken } = await createTokenResponse({
        credential_issuer: credentialOffer.credential_issuer,
        subjectDid,
        tokenRequest: requestToken,
        authorization_server: authorizationServer,
        privateKey,
      })
      response = await OpenIdService.sendTokenResponse({
        redirect_uri,
        id_token: idToken,
        ...(state != null && { state }),
      })
    } else {
      // A presentation of certificates the server asks for with a DCQL query (OpenID4VP 1.0).
      const request = decodeJwt(requestToken) as unknown as PresentationRequest
      if (!request?.dcql_query?.credentials?.length)
        throw new Error(openIdI18nKeys.ERROR_INVALID_PRESENTATION_DEFINITION)
      const { vpToken, presentations } = await presentFor(
        { ...request, client_id: request.client_id ?? authorizationServer },
        { t, showModal },
      )
      signedPresentations = presentations
      response = await OpenIdService.sendTokenResponse({
        redirect_uri: request.response_uri ?? redirect_uri,
        vp_token: vpToken,
        ...(state != null && { state }),
      })
      presentation = true
    }

    const { code }: AuthorizationResponse = processAuthorizationResponse(response)
    if (!code || code.toLowerCase().includes('denied'))
      throw new Error(t(openIdI18nKeys.ERROR_AUTHORIZATION_RESPONSE_CODE))

    tokenResponse = await OpenIdService.sendTokenRequest(
      {
        grant_type: 'authorization_code',
        redirect_uri: 'openid://callback',
        client_id: subjectDid,
        code,
        code_verifier: verifier,
      },
      openIdConfiguration.token_endpoint,
    )
  }

  const trustedFrameworkOfDid = getTrustedFrameworkFromDid(subjectDid)
  // The key proof: a fresh c_nonce from the Nonce Endpoint, when the issuer offers one.
  const proof = async () => {
    const nonce = openIdCredentialIssuer.nonce_endpoint
      ? await OpenIdService.getNonce(openIdCredentialIssuer.nonce_endpoint)
      : undefined
    const now = Math.floor(Date.now() / 1000)
    return signJWT({
      header: { typ: 'openid4vci-proof+jwt', kid: subjectDid },
      trustedFramework: trustedFrameworkOfDid,
      payload: {
        iat: now,
        // The client's id after the authorization code flow; omitted after anonymous access
        // with a pre-authorized code (OpenID4VCI 1.0, appendix F.1).
        ...(!preAuthorized && { iss: subjectDid }),
        aud: issuerUri,
        exp: now + 300,
        ...(nonce != null && { nonce }),
      },
      privateKey,
    })
  }
  const request = async () =>
    OpenIdService.getCredentialRequest({
      accessToken: tokenResponse.access_token,
      credentialConfigurationId: chosenCredential.id,
      openIdCredentialIssuer,
      proof: await proof(),
    })
  let credentialResponse
  try {
    credentialResponse = await request()
  } catch (error: any) {
    // A nonce that went stale between the two requests: once more with a fresh one.
    if (error?.code !== 'invalid_nonce') throw error
    credentialResponse = await request()
  }

  const credential = credentialResponse?.credentials?.[0]?.credential
  if (!credential && credentialResponse?.transaction_id) {
    if (!openIdCredentialIssuer.deferred_credential_endpoint) throw new Error(openIdI18nKeys.ERROR_CREDENTIAL_DEFERRED)
    // Collected later, with the transaction id and the access token.
    const deferredCredential: DeferredCredential = {
      transaction_id: credentialResponse.transaction_id,
      access_token: tokenResponse.access_token,
      credential_endpoint: openIdCredentialIssuer.deferred_credential_endpoint,
      // Whose binding key it is bound to (D34).
      issuerUri,
    }
    await saveDeferredCredential(deferredCredential)
    message = t(openIdI18nKeys.SUCCESS_DEFERRED)
  } else if (typeof credential === 'string' && credential) {
    // With the issuer whose binding key it is bound to (D34).
    await saveCredential(credential, 'credential', { issuerUri })
    if (presentation) {
      // The presentation history stores the signed VP events, not a duplicate of that VC.
      for (const signed of signedPresentations) await savePresentation(signed)
      message = t(openIdI18nKeys.SUCCESS_PRESENTATION)
    } else message = t(openIdI18nKeys.SUCCESS)
  } else throw new Error(openIdI18nKeys.ERROR_CREDENTIAL)
  return message
}
