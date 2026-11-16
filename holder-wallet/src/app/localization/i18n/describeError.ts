// What went wrong, in the holder's language.
// Errors reach the wallet from the network stack, axios, the OpenID flows and
// the issuer's or verifier's servers, and all of those speak English. They were
// shown as they came - "AxiosError: Request failed with status code 404" under
// a Slovak heading. Here each is turned into a sentence from the openId bundle
// (app/localization/i18n); the original goes to the log, where a developer needs it.
import i18next from 'i18next'
import localeSK from './sk'
import localeEN from './en'
import openIdI18nKeys from './keys'

const bundleName = 'openId'
i18next.addResourceBundle('sk', bundleName, localeSK, true, false)
i18next.addResourceBundle('en', bundleName, localeEN, true, false)

const t = (key: string): string => String(i18next.getFixedT(null, bundleName)(key))

type Reason = keyof typeof openIdI18nKeys

// Wording that identifies the cause, from any of the sources above.
const PHRASES: [RegExp, Reason][] = [
  // Java's socket timeout is a timeout, whatever wraps it ("fetch failed: java.net…").
  [/sockettimeoutexception/i, 'REASON_TIMEOUT'],
  [
    // React Native's fetch on Android reports a refused or unroutable connection as
    // "fetch failed: java.net.ConnectException: Failed to connect to /host:port".
    /network request failed|network error|failed to fetch|fetch failed|failed to connect|connectexception|connection refused|unknownhostexception|noroutetohostexception|econnrefused|enotfound|ehostunreach|unable to resolve host|socket hang up/i,
    'REASON_NETWORK',
  ],
  [/timeout|timed out|etimedout|aborted/i, 'REASON_TIMEOUT'],
  // The back-office returns machine-readable refusal reasons as one word
  // ("Pre-authorized code refused: OfferAlreadyRedeemed"), hence the optional spaces.
  [/already been redeemed|already ?redeemed|already used/i, 'REASON_OFFER_USED'],
  [/offer ?locked/i, 'REASON_OFFER_LOCKED'],
  [/no certificate is bound|not bound to this code|offer ?not ?found|unknown offer/i, 'REASON_OFFER_UNKNOWN'],
  [/user[_ ]?pin|tx[_ ]?code|invalid ?pin|pin ?invalid|pin ?required|wrong pin|incorrect pin/i, 'REASON_INVALID_PIN'],
  // A TI's accreditation that ended (design decisions D23) is not an expired offer or certificate.
  [/accreditation ?expired|accreditation.*ended/i, 'REASON_ACCREDITATION_EXPIRED'],
  [/expired|has expired|expiration/i, 'REASON_EXPIRED'],
  [/suspended/i, 'REASON_SUSPENDED'],
  [/revoked/i, 'REASON_REVOKED'],
  [/signature|not in .* did document|invalid proof|proof/i, 'REASON_SIGNATURE'],
  [/unsupported.*(credential|type)|credential type/i, 'REASON_UNSUPPORTED_TYPE'],
  [
    /json|unexpected token|cannot convert null|undefined is not|cannot read propert|is not a function/i,
    'REASON_INVALID_DATA',
  ],
]

// OAuth 2.0 and OpenID for Verifiable Credentials error codes.
const CODES: Record<string, Reason> = {
  invalid_grant: 'REASON_INVALID_GRANT',
  invalid_request: 'REASON_BAD_REQUEST',
  invalid_client: 'REASON_BAD_REQUEST',
  invalid_scope: 'REASON_BAD_REQUEST',
  unauthorized_client: 'REASON_UNAUTHORIZED',
  invalid_token: 'REASON_INVALID_TOKEN',
  expired_token: 'REASON_INVALID_TOKEN',
  invalid_proof: 'REASON_SIGNATURE',
  invalid_or_missing_proof: 'REASON_SIGNATURE',
  unsupported_credential_type: 'REASON_UNSUPPORTED_TYPE',
  unsupported_credential_format: 'REASON_UNSUPPORTED_TYPE',
  access_denied: 'REASON_ACCESS_DENIED',
  server_error: 'REASON_SERVER',
  temporarily_unavailable: 'REASON_SERVER',
  authorization_pending: 'REASON_PENDING',
  slow_down: 'REASON_PENDING',
  // OpenID4VCI 1.0 Credential Endpoint errors.
  invalid_credential_request: 'REASON_BAD_REQUEST',
  unknown_credential_configuration: 'REASON_UNSUPPORTED_TYPE',
  unknown_credential_identifier: 'REASON_UNSUPPORTED_TYPE',
  invalid_nonce: 'REASON_SIGNATURE',
  invalid_encryption_parameters: 'REASON_BAD_REQUEST',
  credential_request_denied: 'REASON_ACCESS_DENIED',
  issuance_pending: 'REASON_PENDING',
  invalid_transaction_id: 'REASON_NOT_FOUND',
}

const byStatus = (status: number): Reason => {
  if (status === 400 || status === 422) return 'REASON_BAD_REQUEST'
  if (status === 401 || status === 403) return 'REASON_UNAUTHORIZED'
  if (status === 404) return 'REASON_NOT_FOUND'
  if (status === 409) return 'REASON_OFFER_USED'
  if (status === 410) return 'REASON_EXPIRED'
  if (status === 408 || status === 504) return 'REASON_TIMEOUT'
  if (status >= 500) return 'REASON_SERVER'
  return 'REASON_UNKNOWN'
}

const messageOf = (error: any): string => String(typeof error === 'string' ? error : (error?.message ?? ''))

const parts = (error: any) => {
  const data = error?.response?.data
  const description = typeof data === 'string' ? data : (data?.error_description ?? data?.detail ?? data?.message)
  const code = (typeof data === 'object' && data?.error) || error?.error
  const message = messageOf(error)
  const status = error?.response?.status ?? Number(/status code (\d{3})/i.exec(message)?.[1] ?? 0)
  return {
    description: String(description ?? error?.error_description ?? ''),
    code: code ? String(code) : '',
    message,
    status,
  }
}

/** A sentence in the holder's language for any error. */
export const describeError = (error: unknown): string => {
  const { description, code, message, status } = parts(error)
  const text = [description, message].filter(Boolean).join(' ')
  // An i18n key thrown as the message: the service layer does that.
  if (message in openIdI18nKeys) return t(message)
  const phrase = PHRASES.find(([pattern]) => pattern.test(text))
  const reason: Reason =
    (phrase && phrase[1]) || (code && CODES[code]) || (status ? byStatus(status) : 'REASON_UNKNOWN')
  if (reason === 'REASON_UNKNOWN' || reason === 'REASON_INVALID_DATA') {
    console.warn('[wallet] error shown to the holder as a generic message:', text || error)
  }
  return t(reason)
}

// Every sentence of the openId bundle in the active language: an error whose
// message starts with one was raised by our own code and is already translated.
const translatedSentences = (): string[] => {
  const bundle = i18next.getResourceBundle(i18next.language, bundleName) ?? {}
  return Object.values(bundle).filter((value): value is string => typeof value === 'string' && value.length > 3)
}

/** What to show for an error caught at the edge of a flow. */
export const toUserMessage = (error: unknown): string => {
  const message = messageOf(error)
  if (message && translatedSentences().some((sentence) => message.startsWith(sentence))) return message
  return describeError(error)
}

/** A heading from the bundle followed by the cause, e.g. for a failed request. */
export const withCause = (headingKey: string, error: unknown): string => `${t(headingKey)}. ${describeError(error)}`
