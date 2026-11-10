// The verifier's side of an exchange (design decisions D33): send the request the
// holder's QR code invites, encrypted to its key, and wait for the answer.
import { fetchWithin } from '@infrastructure/network/http'
import { newEphemeralKey, open, publicJwk, randomToken, seal } from './crypto'
import { thumbprint } from '@infrastructure/backup/keys'
import { DECISION_TTL_MS, FieldSelection, Invitation, Presentation, buildRequest, exchangeIdOf } from './protocol'

const POLL_MS = 1000
const TOLERATED_FAILURES = 5
// Each request to the holder's phone; generous, for a slow Wi-Fi.
const TIMEOUT_MS = 30000

export class ExchangeDeclined extends Error {}
export class ExchangeExpired extends Error {}
export class ExchangeFailed extends Error {}

export type Asked = {
  presentation: Presentation
  challenge: string
  domain: string
  fields: FieldSelection
}

const send = (url: string, token: string, init: RequestInit = {}) =>
  fetchWithin(
    url,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    },
    TIMEOUT_MS,
    (response) => response,
  )

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Ask the holder behind `invitation` for a certificate of `types`, with the
 * `fields` it must and may show. Resolves with the presentation once the
 * holder agreed; throws ExchangeDeclined, ExchangeExpired or ExchangeFailed.
 */
export const askForPresentation = async (
  invitation: Invitation,
  types: string[],
  fields: FieldSelection,
  { verifierName, reason, isCancelled }: { verifierName?: string; reason?: string; isCancelled?: () => boolean } = {},
): Promise<Asked> => {
  const key = newEphemeralKey()
  const exchangeId = exchangeIdOf(invitation.url)
  const challenge = randomToken(24)
  // No domain of its own: the verifier is named by this exchange's key.
  const domain = `urn:plr:verifier:${thumbprint(publicJwk(key))}`
  const request = buildRequest(types, fields, challenge, domain, verifierName, reason)
  const envelope = seal(key, invitation.key, exchangeId, 'request', { verifiablePresentationRequest: request }, true)

  let response: Response
  try {
    response = await send(invitation.url, invitation.token, { method: 'POST', body: JSON.stringify({ envelope }) })
  } catch (error: any) {
    throw new ExchangeFailed(String(error?.message ?? error))
  }
  if (response.status === 410) throw new ExchangeExpired('The exchange is closed')
  if (response.status !== 202) throw new ExchangeFailed(`The holder's wallet answered ${response.status}`)

  // As long as the holder has to decide once the request reached them.
  const until = Date.now() + DECISION_TTL_MS
  let failures = 0
  while (Date.now() < until) {
    if (isCancelled?.()) throw new ExchangeFailed('Cancelled')
    await wait(POLL_MS)
    let polled: Response
    try {
      polled = await send(invitation.url, invitation.token)
    } catch (error: any) {
      if (++failures >= TOLERATED_FAILURES) throw new ExchangeFailed(String(error?.message ?? error))
      continue
    }
    failures = 0
    if (polled.status === 202) continue
    if (polled.status === 403) throw new ExchangeDeclined('The holder declined')
    if (polled.status === 410 || polled.status === 404) throw new ExchangeExpired('The exchange is closed')
    if (polled.status !== 200) throw new ExchangeFailed(`The holder's wallet answered ${polled.status}`)
    const body = await polled.json()
    const { verifiablePresentation } = open(key, invitation.key, exchangeId, 'response', body?.envelope)
    return { presentation: verifiablePresentation, challenge, domain, fields }
  }
  throw new ExchangeExpired('The holder did not answer in time')
}
