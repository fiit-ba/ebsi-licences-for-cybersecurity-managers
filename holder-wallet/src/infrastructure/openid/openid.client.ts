import axios from 'axios'

// Generous, for a phone on a slow connection.
const TIMEOUT_MS = 30000

export const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) throw Object.assign(new Error('fetching error'), { response: { status: response.status } })
  return response.json()
}

export const getJson = async <T>(url: string): Promise<T> => (await axios.get(url)).data

export const fetchAuthorizationRedirect = async (url: string): Promise<string> => {
  const response = await fetch(url, { method: 'GET' })
  return response.url
}

// A request object by reference (RFC 9101): the signed JWT, as text.
export const fetchRequestObject = async (url: string): Promise<string> =>
  (
    await axios.get(url, {
      headers: { Accept: 'application/oauth-authz-req+jwt, application/jwt' },
      responseType: 'text',
      transformResponse: (data) => data,
      timeout: TIMEOUT_MS,
    })
  ).data

export const fetchJwks = async (url: string): Promise<{ keys: Array<{ kid: string; [key: string]: any }> }> =>
  (await axios.get(url)).data

const formOptions = {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
}

export const postAuthorizationResponse = (url: string, data?: string) =>
  axios.post(url, data, { ...formOptions, maxRedirects: 0 })

// OpenID4VP 1.0 direct_post: the verifier answers 200, with JSON that may name a redirect_uri.
export const postPresentationResponse = (url: string, data: string) =>
  axios.post(url, data, { ...formOptions, maxRedirects: 0, timeout: TIMEOUT_MS })

// OpenID4VCI 1.0 Nonce Endpoint: a POST without a body.
export const postNonceRequest = async <T>(url: string): Promise<T> =>
  (await axios.post(url, undefined, { timeout: TIMEOUT_MS })).data

export const postTokenRequest = async <T>(url: string, data: string): Promise<T> =>
  (await axios.post(url, data, formOptions)).data

export const postCredentialRequest = async <T>(url: string, accessToken: string, data: string): Promise<T> =>
  (
    await axios.request({
      method: 'post',
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      data,
    })
  ).data

// OpenID4VCI 1.0 Deferred Credential Request: JSON with the transaction id, and the access token.
export const postDeferredCredentialRequest = async <T>(url: string, accessToken: string, data: string): Promise<T> =>
  (
    await axios.request({
      method: 'post',
      url,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data,
      timeout: TIMEOUT_MS,
    })
  ).data
