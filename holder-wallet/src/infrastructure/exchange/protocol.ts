// Presenting a certificate phone to phone, after the W3C VC-API's exchanges
// (design decisions D33).
//   1. The holder's wallet opens an exchange on a small HTTP server of its
//      own and shows a QR code: the exchange's URL, a one-time token and an
//      ephemeral public key (the invitation).
//   2. The verifier scans it and POSTs a VerifiablePresentationRequest - a
//      QueryByExample for a certificate type, which of its fields it needs and
//      which it would like, a challenge and its domain - encrypted to that key.
//   3. The holder sees who asks and for what, and that the whole certificate
//      goes - a W3C JWT-VC is signed as one, so it cannot be shown in part
//      (D34) - and confirms with the PIN. The wallet answers with a
//      VerifiablePresentation: a JWT-VP signed by the holder's DID over the
//      challenge and the verifier's domain, holding the certificate,
//      encrypted back to the verifier, who polls the exchange for it.
//   4. The verifier checks everything itself, from EBSI's registries and the
//      ledger. Neither phone asks the back-office anything. The Verifier
//      Service plays the verifier the same way, for the console and for
//      relying parties that scan the code (D35).
import { PublicJwk } from './es256'

export const INVITATION_TYPE = 'PlrPresentationExchange'
export const QUERY_TYPE = 'QueryByExample'
export const ENVELOPED_PRESENTATION = 'EnvelopedVerifiablePresentation'
export const JWT_MEDIA_TYPE = 'application/jwt'

/** How long an exchange's QR code lets a verifier connect. */
export const EXCHANGE_TTL_MS = 2 * 60 * 1000

/**
 * How long the holder has to answer a request once it reaches the wallet:
 * reading who asks, choosing what to share (design decisions D36) and confirming
 * with the PIN take longer than a verifier takes to connect.
 */
export const DECISION_TTL_MS = 5 * 60 * 1000

export type Invitation = {
  type: typeof INVITATION_TYPE
  v: 1
  /** http://<the holder's address on the Wi-Fi>:<port>/exchanges/<id> */
  url: string
  /** Bearer token of this exchange, shown only in the QR code. */
  token: string
  /** The holder's ephemeral key, which the request is encrypted to. */
  key: PublicJwk
}

export type FieldSelection = { mandatory: string[]; optional: string[] }

export type PresentationRequest = {
  query: {
    type: typeof QUERY_TYPE
    credentialQuery: {
      reason?: string
      example: { type: string[] }
      'plr:mandatory': string[]
      'plr:optional': string[]
    }
  }[]
  challenge: string
  domain: string
  'plr:verifier'?: { name?: string }
}

/** A JWT-VP, enveloped as VCDM 2.0 carries a presentation secured as a JWT. */
export type Presentation = {
  '@context': string[]
  type: typeof ENVELOPED_PRESENTATION
  id: string
}

/** What a verifier asks of a cybersecurity manager's certificate, unless it says otherwise. */
export const CERTIFICATE_TYPE = 'CybersecurityManagerCertificate'
export const DEFAULT_FIELDS: FieldSelection = {
  mandatory: ['certificateTitle', 'holderName', 'certificateNumber', 'certificationBody'],
  optional: [
    'jobPosition',
    'trainingName',
    'trainingStart',
    'trainingEnd',
    'trainingDays',
    'teachingHours',
    'knowledgeStandard',
    'placeOfIssue',
    'issueDate',
    'signatory',
    'funding',
  ],
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** The exchange's id: the last segment of its URL. */
export const exchangeIdOf = (url: string): string => {
  const match = /\/exchanges\/([A-Za-z0-9_-]{16,64})$/.exec(String(url ?? ''))
  if (!match) throw new Error('Not an exchange URL')
  return match[1]
}

export const encodeInvitation = (invitation: Invitation): string => JSON.stringify(invitation)

/** A scanned QR code as an invitation, or null when it is something else. */
export const parseInvitation = (text: string): Invitation | null => {
  let value: any
  try {
    value = JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
  if (value?.type !== INVITATION_TYPE || value?.v !== 1) return null
  if (typeof value.url !== 'string' || !/^http:\/\/[0-9a-zA-Z.:[\]-]+:\d{1,5}\/exchanges\//.test(value.url)) return null
  try {
    exchangeIdOf(value.url)
  } catch {
    return null
  }
  if (typeof value.token !== 'string' || value.token.length < 32 || !BASE64URL.test(value.token)) return null
  if (value.key?.kty !== 'EC' || value.key?.crv !== 'P-256' || !value.key?.x || !value.key?.y) return null
  return {
    type: INVITATION_TYPE,
    v: 1,
    url: value.url,
    token: value.token,
    key: { kty: 'EC', crv: 'P-256', x: value.key.x, y: value.key.y },
  }
}

export const isInvitation = (text: string): boolean => parseInvitation(text) !== null

export const buildRequest = (
  types: string[],
  fields: FieldSelection,
  challenge: string,
  domain: string,
  verifierName?: string,
  reason?: string,
): PresentationRequest => ({
  query: [
    {
      type: QUERY_TYPE,
      credentialQuery: {
        ...(reason ? { reason } : {}),
        example: { type: types },
        'plr:mandatory': fields.mandatory,
        'plr:optional': fields.optional,
      },
    },
  ],
  challenge,
  domain,
  ...(verifierName ? { 'plr:verifier': { name: verifierName } } : {}),
})

/** A request's query, checked: the type wanted and its fields, or an error. */
export const queryOf = (request: PresentationRequest) => {
  const query = request?.query?.find((entry) => entry?.type === QUERY_TYPE)?.credentialQuery
  const types = query?.example?.type
  if (!query || !Array.isArray(types) || types.length === 0) throw new Error('The request names no certificate type')
  if (typeof request.challenge !== 'string' || request.challenge.length < 16)
    throw new Error('The request has no challenge')
  if (typeof request.domain !== 'string' || !request.domain) throw new Error('The request has no domain')
  const names = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((name): name is string => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
      : []
  const mandatory = names(query['plr:mandatory'])
  const optional = names(query['plr:optional']).filter((name) => !mandatory.includes(name))
  return {
    types: types.map(String),
    mandatory,
    optional,
    reason: typeof query.reason === 'string' ? query.reason.slice(0, 300) : undefined,
    verifierName:
      typeof request['plr:verifier']?.name === 'string' ? request['plr:verifier'].name.slice(0, 100) : undefined,
  }
}

/** The answer to a request: the holder's JWT-VP, enveloped. */
export const envelopePresentation = (jwtVp: string): Presentation => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ENVELOPED_PRESENTATION,
  id: `data:${JWT_MEDIA_TYPE},${jwtVp}`,
})

/** The JWT-VP inside an answer, or an error. */
export const presentedJwtOf = (presentation: Presentation): string => {
  const prefix = `data:${JWT_MEDIA_TYPE},`
  if (
    presentation?.type !== ENVELOPED_PRESENTATION ||
    typeof presentation.id !== 'string' ||
    !presentation.id.startsWith(prefix)
  ) {
    throw new Error('The answer holds no presentation')
  }
  const jwt = presentation.id.slice(prefix.length)
  if (jwt.split('.').length !== 3) throw new Error('The answer holds no presentation')
  return jwt
}
