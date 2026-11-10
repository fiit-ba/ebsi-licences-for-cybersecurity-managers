// An OpenID4VP 1.0 request object (section 5) is trusted only once it verifies.
// The verifier is identified by a DID (client identifier prefix
// `decentralized_identifier`, section 5.9.3): the request is signed with a key
// of that DID, named by the JOSE header's kid, and the wallet takes the key from
// the DID document - EBSI's DID Registry for a did:ebsi, the identifier itself
// for a did:key - never from the request.
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { ebsi } from '@infrastructure/config/Ebsi'
import { fetchWithin } from '@infrastructure/network/http'
import { PublicJwk, didKeyJwk, verifyEs256 } from '@infrastructure/exchange/es256'
import type { PresentationRequest } from './types'

export const DID_CLIENT_PREFIX = 'decentralized_identifier:'
/** Generous, for a phone on a slow connection. */
const TIMEOUT_MS = 30000
const CLOCK_SKEW_SECONDS = 60

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : [])

/** The P-256 key `kid` of `did`, as its DID document lists it for authentication or assertions. */
const keyOf = async (did: string, kid: string): Promise<PublicJwk | null> => {
  if (did.startsWith('did:key:')) return kid === did || kid.startsWith(`${did}#`) ? didKeyJwk(did) : null
  if (!did.startsWith('did:ebsi:') || !ebsi.isConfigured() || !kid.startsWith(`${did}#`)) return null
  const document: any = await fetchWithin(
    `${ebsi.didRegistry()}/identifiers/${encodeURIComponent(did)}`,
    { headers: { Accept: 'application/did+json, application/json' } },
    TIMEOUT_MS,
    (response) => {
      if (!response.ok) throw new Error(`${response.status} from the DID Registry`)
      return response.json()
    },
  )
  const method = asList(document?.verificationMethod).find((item: any) => item?.id === kid) as any
  const listed = ['assertionMethod', 'authentication'].some((relationship) =>
    asList(document?.[relationship]).some((ref: any) => (typeof ref === 'string' ? ref : ref?.id) === kid),
  )
  const jwk = method?.publicKeyJwk
  if (!listed || jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk.x || !jwk.y) return null
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

/**
 * The verified request, or an error saying why it is not one this wallet answers.
 * @param jwt - The request object fetched from request_uri.
 * @param clientId - The client identifier of the invocation URI, which the request must repeat.
 */
export const verifyRequestObject = async (jwt: string, clientId: string): Promise<PresentationRequest> => {
  const header = decodeProtectedHeader(jwt)
  const payload = decodeJwt(jwt) as unknown as PresentationRequest
  if (header.typ !== 'oauth-authz-req+jwt' || header.alg !== 'ES256' || typeof header.kid !== 'string')
    throw new Error('The request object is not an ES256 oauth-authz-req+jwt with a kid')
  if (!clientId.startsWith(DID_CLIENT_PREFIX) || payload.client_id !== clientId)
    throw new Error('The request object names another client')
  const did = clientId.slice(DID_CLIENT_PREFIX.length)
  const key = await keyOf(did, header.kid)
  if (!key || !verifyEs256(jwt, key)) throw new Error("The request object is not signed with a key of the client's DID")
  const now = Date.now() / 1000
  if (typeof payload.exp === 'number' && payload.exp < now - CLOCK_SKEW_SECONDS)
    throw new Error('The request object has expired')
  if (payload.aud !== undefined && payload.aud !== 'https://self-issued.me/v2')
    throw new Error('The request object is meant for another audience')
  if (
    payload.response_type !== 'vp_token' ||
    payload.response_mode !== 'direct_post' ||
    typeof payload.response_uri !== 'string' ||
    !/^https?:\/\//.test(payload.response_uri) ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce ||
    !Array.isArray(payload.dcql_query?.credentials) ||
    !payload.dcql_query.credentials.length
  )
    throw new Error('The request asks for a vp_token by direct_post with a DCQL query, or it is not answered')
  return payload
}
