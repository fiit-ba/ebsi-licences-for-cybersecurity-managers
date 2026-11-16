import {
  CredentialOffer,
  CredentialResponse,
  OpenIdConfiguration,
  OpenIdCredentialIssuer,
  AuthorizationRequestResponse,
  PresentationRequest,
  TokenRequest,
  TokenResponse,
} from '@infrastructure/openid/types'
import { convertUriToObject } from '@shared/utils/url'
import { keyFromJWK, selectCurve } from '@infrastructure/crypto/legacyCrypto'
import { v4 as uuidv4 } from 'uuid'
import openIdI18nKeys from '@app/localization/i18n/keys'
// Errors described in Slovak.
import { describeError, withCause } from '@app/localization/i18n/describeError'
import i18next from 'i18next'
// Removes the Spanish strings: the wallet offers Slovak and English.
import {
  fetchAuthorizationRedirect,
  fetchJson,
  fetchJwks,
  fetchRequestObject,
  getJson,
  postAuthorizationResponse,
  postCredentialRequest,
  postDeferredCredentialRequest,
  postNonceRequest,
  postPresentationResponse,
  postTokenRequest,
} from './openid.client'
import { decodeJwtHeader, decodeJwtPayload } from './openidJwt.adapter'
import { hasResponseToken } from './openid.validator'
import { buildAuthorizationRequest } from './authorization.mapper'
import { verifyRequestObject } from './requestObject'
import localeSK from '@app/localization/i18n/sk'
import localeEN from '@app/localization/i18n/en'

const bundleName = 'openId'
// Registers no Spanish strings: the wallet offers Slovak and English.
i18next.addResourceBundle('sk', bundleName, localeSK)
i18next.addResourceBundle('en', bundleName, localeEN)

class OpenId {
  t: (key: string) => string
  constructor() {
    // Follow the active language instead of pinning Spanish.
    // Every error this service raises was reaching the holder in Spanish
    // however the app was set, because the translator was fixed to 'es'.
    this.t = i18next.getFixedT(null, bundleName)
  }

  async getCredentialOffer(credential_offer_uri: string) {
    const credentialOffer: CredentialOffer = await fetchJson<CredentialOffer>(credential_offer_uri).catch((error) => {
      // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
      // English detail of the library.
      throw new Error(withCause(openIdI18nKeys.ERROR_CREDENTIAL_OFFER, error))
    })

    return credentialOffer
  }

  // OpenID4VCI 1.0 metadata. An issuer at the root of its host serves it at
  // /.well-known/openid-credential-issuer; one under a path at the well-known
  // location with the path after it (RFC 8615), or, as EBSI's services, appended.
  async getOpenIdCredentialIssuer(credential_issuer: string) {
    const issuer = credential_issuer.replace(/\/+$/, '')
    const metadata = await firstOf<OpenIdCredentialIssuer>(wellKnown(issuer, 'openid-credential-issuer')).catch(
      (error) => {
        // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
        // English detail of the library.
        throw new Error(withCause(openIdI18nKeys.ERROR_OPENID_ISSUER, error))
      },
    )
    if (!metadata?.credential_endpoint || typeof metadata.credential_configurations_supported !== 'object')
      throw new Error(this.t(openIdI18nKeys.ERROR_OPENID_ISSUER))
    return metadata
  }

  // The authorization server's metadata (RFC 8414), or its OpenID configuration.
  async getOpenIdConfiguration(authorization_server: string) {
    const server = authorization_server.replace(/\/+$/, '')
    const openIdConfiguration = await firstOf<OpenIdConfiguration>([
      ...wellKnown(server, 'oauth-authorization-server'),
      ...wellKnown(server, 'openid-configuration'),
    ]).catch((error) => {
      // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
      // English detail of the library.
      throw new Error(withCause(openIdI18nKeys.ERROR_OPENID_CONFIGURATION, error))
    })
    if (!openIdConfiguration?.token_endpoint) throw new Error(this.t(openIdI18nKeys.ERROR_OPENID_CONFIGURATION))
    return openIdConfiguration
  }

  /** A fresh c_nonce from the issuer's Nonce Endpoint (OpenID4VCI 1.0, section 7). */
  async getNonce(nonceEndpoint: string): Promise<string> {
    const response = await postNonceRequest<{ c_nonce?: string }>(nonceEndpoint).catch((error) => {
      throw new Error(withCause(openIdI18nKeys.ERROR_CREDENTIAL, error))
    })
    if (typeof response?.c_nonce !== 'string' || !response.c_nonce)
      throw new Error(this.t(openIdI18nKeys.ERROR_CREDENTIAL))
    return response.c_nonce
  }

  async sendAuthorizationRequest({
    issuerState: issuerState,
    subjectDid,
    challenge,
    authorizationEndpoint,
    credentialConfigurationId,
    locations,
    scope,
  }: {
    issuerState?: string
    authorizationEndpoint: string
    subjectDid: string
    challenge: string
    credentialConfigurationId: string
    locations: string
    scope: string[]
  }) {
    const params = buildAuthorizationRequest(
      { issuerState, subjectDid, challenge, credentialConfigurationId, locations, scope },
      uuidv4(),
    )

    const queryString = new URLSearchParams(params).toString()
    const urlWithParams = `${authorizationEndpoint}?${queryString}`

    let authRequestUri
    try {
      authRequestUri = await fetchAuthorizationRedirect(urlWithParams)
    } catch (error) {
      // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
      // English detail of the library.
      throw new Error(withCause(openIdI18nKeys.ERROR_AUTHORIZATION_REQUEST, error))
    }

    const authorizationRequestResponse: AuthorizationRequestResponse = convertUriToObject(authRequestUri!) as any

    const { error, error_description } = authorizationRequestResponse ?? {}
    if (error || error_description) {
      // The server's error, described in Slovak rather than shown as sent.
      throw new Error(describeError({ error, error_description: error_description?.split('+').join(' ') }))
    }

    return authorizationRequestResponse
  }

  async processTokenRequest(authorizationRequestObject: AuthorizationRequestResponse) {
    if (authorizationRequestObject.request_uri) {
      const idTokenRequest: string = await fetchRequestObject(authorizationRequestObject.request_uri).catch((error) => {
        // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
        // English detail of the library.
        throw new Error(withCause(openIdI18nKeys.ERROR_IDTOKEN_REQUEST, error))
      })

      return idTokenRequest
    } else if (authorizationRequestObject.request) {
      return authorizationRequestObject.request as string
    } else throw this.t(openIdI18nKeys.ERROR_IDTOKEN_REQUEST)
  }

  async getKeyFromTokenRequest({ token, jwks_uri }: { token: string; jwks_uri: string }) {
    const header = decodeJwtHeader(token)
    const jwksUriData = await fetchJwks(jwks_uri)
    const selectedKey = jwksUriData.keys.find(({ kid }) => kid.includes(header.kid!))

    if (!selectedKey) throw this.t(openIdI18nKeys.ERROR_VALIDATION_JWT)
    const curveName = header.alg
    const curve = selectCurve(curveName as any)
    const key = await keyFromJWK(selectedKey, curve)

    return key
  }

  // The answer to an authorization server's own request during issuance: an ID token, or
  // an OpenID4VP 1.0 vp_token - a JSON object of presentations by credential query id.
  async sendTokenResponse({
    redirect_uri,
    vp_token,
    id_token,
    state,
  }: {
    redirect_uri: string
    vp_token?: Record<string, string[]>
    id_token?: string
    state?: string
  }) {
    try {
      if (!hasResponseToken(vp_token && JSON.stringify(vp_token), id_token)) {
        // A Slovak message instead of an English one.
        throw new Error(this.t(openIdI18nKeys.ERROR_NO_RESPONSE_TOKEN))
      }

      const data = new URLSearchParams({
        ...(vp_token ? { vp_token: JSON.stringify(vp_token) } : { id_token: id_token! }),
        ...(state != null && { state }),
      }).toString()
      const result = await postAuthorizationResponse(redirect_uri, data)
      const response = result.status === 302 ? result.headers['location'] : result?.request?.responseURL

      const { error, error_description } = (response ?? {}) as any
      if (error || error_description) {
        // The server's error, described in Slovak rather than shown as sent.
        throw new Error(describeError({ error, error_description: error_description?.split('+').join(' ') }))
      }

      return response
    } catch (error: any) {
      // The cause in Slovak (app/localization/i18n/describeError.ts), not the raw
      // English detail of the library.
      throw new Error(withCause(openIdI18nKeys.ERROR_AUTHORIZATION_RESPONSE, error))
    }
  }

  /**
   * An OpenID4VP 1.0 request by reference: the signed request object behind
   * `request_uri`, verified with a key of the DID its client identifier names.
   */
  async getPresentationRequest(uri: string): Promise<PresentationRequest> {
    const params = parseQuery(uri)
    if (!params.request_uri || !params.client_id) throw new Error(this.t(openIdI18nKeys.ERROR_PRESENTATION_OFFER))
    if (params.request_uri_method && params.request_uri_method !== 'get')
      throw new Error(this.t(openIdI18nKeys.ERROR_UNSUPPORTED_REQUEST))
    const requestObject: string = await fetchRequestObject(params.request_uri).catch((error) => {
      throw new Error(withCause(openIdI18nKeys.ERROR_PRESENTATION_OFFER, error))
    })
    return verifyRequestObject(String(requestObject).trim(), params.client_id).catch((error) => {
      console.warn('[wallet] presentation request refused:', error?.message ?? error)
      throw new Error(this.t(openIdI18nKeys.ERROR_REQUEST_OBJECT))
    })
  }

  /** Post the OpenID4VP 1.0 response to the verifier's response_uri (direct_post). */
  async sendPresentationResponse({
    request,
    vpToken,
  }: {
    request: PresentationRequest
    vpToken: Record<string, string[]>
  }): Promise<boolean> {
    const data = new URLSearchParams({
      vp_token: JSON.stringify(vpToken),
      ...(request.state != null && { state: request.state }),
    }).toString()
    try {
      const response = await postPresentationResponse(request.response_uri, data)
      return response.status >= 200 && response.status < 300
    } catch (error: any) {
      // The holder is told what the refusal means, in their language.
      const reason = String(
        error?.response?.data?.error_description ?? error?.response?.data?.error ?? '',
      ).toUpperCase()
      if (error?.response) {
        const key = reason.includes('SUSPENDED')
          ? openIdI18nKeys.PRESENTATION_REFUSED_SUSPENDED
          : reason.includes('REVOKED')
            ? openIdI18nKeys.PRESENTATION_REFUSED_REVOKED
            : reason.includes('EXPIRED')
              ? openIdI18nKeys.PRESENTATION_REFUSED_EXPIRED
              : openIdI18nKeys.PRESENTATION_REFUSED
        throw new Error(`${this.t(key)}`)
      }
      // The cause in Slovak (app/localization/i18n/describeError.ts).
      throw new Error(describeError(error))
    }
  }

  /**
   * Tell the verifier the request will not be answered (OpenID4VP 1.0 error response,
   * response mode direct_post): `access_denied` when the holder declined. Without it
   * the verifier waits until the request expires. True when the verifier took it.
   */
  async sendPresentationError({
    request,
    error,
  }: {
    request: Pick<PresentationRequest, 'response_uri' | 'state'>
    error: 'access_denied'
  }): Promise<boolean> {
    if (!request.response_uri) return false
    const data = new URLSearchParams({
      error,
      ...(request.state != null && { state: request.state }),
    }).toString()
    try {
      const response = await postPresentationResponse(request.response_uri, data)
      return response.status >= 200 && response.status < 300
    } catch {
      return false
    }
  }

  async sendTokenRequest(params: TokenRequest, tokenEndpoint: string) {
    const requestBody = new URLSearchParams(params as any).toString()
    let tokenRequest: TokenResponse
    try {
      tokenRequest = await postTokenRequest<TokenResponse>(tokenEndpoint, requestBody)
      return tokenRequest
    } catch (error: any) {
      // A network failure has no `response`, and a rejection need not
      // carry `error_description`. Reaching through both produced either a
      // second error that buried the first, or the word "undefined"
      // appended to the message the holder was shown.
      const detail = error?.response?.data?.error_description ?? error?.response?.data?.error ?? error?.message
      // The cause in Slovak (app/localization/i18n/describeError.ts); the English
      // detail goes to the log.
      console.warn('[wallet] token request failed:', detail)
      throw new Error(withCause(openIdI18nKeys.ERROR_SENDING_TOKEN_REQUEST, error))
    }
  }

  // OpenID4VCI 1.0 Credential Request: one configuration and one key proof per call.
  async getCredentialRequest({
    accessToken,
    credentialConfigurationId,
    openIdCredentialIssuer,
    proof,
  }: {
    accessToken: string
    credentialConfigurationId: string
    openIdCredentialIssuer: OpenIdCredentialIssuer
    proof: string
  }): Promise<CredentialResponse> {
    try {
      const data = JSON.stringify({
        credential_configuration_id: credentialConfigurationId,
        proofs: { jwt: [proof] },
      })

      return await postCredentialRequest<CredentialResponse>(
        openIdCredentialIssuer.credential_endpoint,
        accessToken,
        data,
      )
    } catch (error: any) {
      // The cause in Slovak; reading error.response.data also threw on a network
      // failure, which has no response.
      throw Object.assign(new Error(withCause(openIdI18nKeys.ERROR_CREDENTIAL, error)), {
        code: error?.response?.data?.error,
      })
    }
  }

  // OpenID4VCI 1.0 Deferred Credential Request: the transaction id, with the access token.
  async getDeferredCredentialRequest({
    transaction_id,
    access_token,
    deferredEndpoint,
  }: {
    transaction_id: string
    access_token: string
    deferredEndpoint: string
  }): Promise<CredentialResponse | undefined> {
    return postDeferredCredentialRequest<CredentialResponse>(
      deferredEndpoint,
      access_token,
      JSON.stringify({ transaction_id }),
    ).catch(() => undefined)
  }
}

/** The well-known locations of `name` for an issuer or server identifier, most likely first. */
const wellKnown = (identifier: string, name: string): string[] => {
  const url = new URL(identifier)
  const path = url.pathname.replace(/\/+$/, '')
  const appended = `${identifier}/.well-known/${name}`
  const inserted = `${url.origin}/.well-known/${name}${path}`
  return path ? [appended, inserted] : [appended]
}

/** The first of the URLs that answers with JSON. */
const firstOf = async <T>(urls: string[]): Promise<T> => {
  let last: unknown
  for (const url of urls) {
    try {
      return await getJson<T>(url)
    } catch (error) {
      last = error
    }
  }
  throw last
}

/** The query parameters of an invocation URI such as `openid4vp://?client_id=…&request_uri=…`. */
export const parseQuery = (uri: string): Record<string, string> => {
  const query = String(uri ?? '')
    .split('?')
    .slice(1)
    .join('?')
  return Object.fromEntries(new URLSearchParams(query))
}

const OpenIdService = new OpenId()

export default OpenIdService
