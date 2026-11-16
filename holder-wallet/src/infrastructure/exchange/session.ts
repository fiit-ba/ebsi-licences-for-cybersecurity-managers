// The holder's side of an exchange (design decisions D33), as plain request and
// response, so it can be tested without a socket (server.ts carries it over
// TCP). One exchange takes one request and gives one answer, then closes.
//   POST /exchanges/{id}   the verifier's encrypted request         -> 202
//   GET  /exchanges/{id}   202 until the holder decides, then the
//                          encrypted presentation (200) or a refusal (403)
// Both need the token from the QR code. A few wrong tokens close the
// exchange, and so does its time running out.
import { ec as EC } from 'elliptic'
import { PublicJwk } from './es256'
import { Envelope, newEphemeralKey, open, publicJwk, randomToken, seal } from './crypto'
import {
  DECISION_TTL_MS,
  EXCHANGE_TTL_MS,
  INVITATION_TYPE,
  Invitation,
  Presentation,
  PresentationRequest,
  queryOf,
} from './protocol'

export type ExchangeState = 'waiting' | 'requested' | 'answered' | 'declined' | 'closed'

export type Query = ReturnType<typeof queryOf> & { challenge: string; domain: string }

export type HttpAnswer = { status: number; body: Record<string, unknown> }

const MAX_WRONG_TOKENS = 5

/** Equal strings, compared in time that does not depend on where they differ. */
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export class HolderExchange {
  readonly id = randomToken(16)
  readonly token = randomToken(32)
  readonly openedAt: number
  /** When the verifier's request came, from which the holder has the decision window. */
  requestedAt?: number
  state: ExchangeState = 'waiting'
  query?: Query
  private readonly key: EC.KeyPair = newEphemeralKey()
  private verifierKey?: PublicJwk
  private answerEnvelope?: Envelope
  private wrongTokens = 0

  constructor(
    readonly origin: string,
    private readonly listeners: {
      onRequest?: (query: Query) => void
      onFinished?: (state: ExchangeState) => void
    } = {},
    private readonly ttlMs = EXCHANGE_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly decisionMs = DECISION_TTL_MS,
  ) {
    this.openedAt = now()
  }

  get invitation(): Invitation {
    return {
      type: INVITATION_TYPE,
      v: 1,
      url: `${this.origin}/exchanges/${this.id}`,
      token: this.token,
      key: publicJwk(this.key),
    }
  }

  /** Past the QR code's time before a request, past the holder's decision window after one. */
  get expired(): boolean {
    return this.requestedAt === undefined
      ? this.now() - this.openedAt > this.ttlMs
      : this.now() - this.requestedAt > this.decisionMs
  }

  private finish(state: ExchangeState) {
    this.state = 'closed'
    this.listeners.onFinished?.(state)
  }

  /** One HTTP request, answered. */
  handle(method: string, path: string, headers: Record<string, string>, body: string): HttpAnswer {
    if (path.split('?')[0] !== `/exchanges/${this.id}`) return { status: 404, body: { error: 'not_found' } }
    if (this.state === 'closed') return { status: 410, body: { error: 'closed' } }
    if (this.expired) {
      this.finish('closed')
      return { status: 410, body: { error: 'expired' } }
    }
    const authorization = headers['authorization'] ?? ''
    if (!same(authorization, `Bearer ${this.token}`)) {
      if (++this.wrongTokens >= MAX_WRONG_TOKENS) this.finish('closed')
      return { status: 401, body: { error: 'unauthorized' } }
    }
    if (method === 'POST') return this.receive(body)
    if (method === 'GET') return this.deliver()
    return { status: 405, body: { error: 'method_not_allowed' } }
  }

  private receive(body: string): HttpAnswer {
    if (this.state !== 'waiting') return { status: 409, body: { error: 'already_requested' } }
    try {
      const envelope = JSON.parse(body)?.envelope as Envelope
      if (!envelope?.epk) throw new Error('The request carries no key')
      const { verifiablePresentationRequest } = open(this.key, envelope.epk, this.id, 'request', envelope) as {
        verifiablePresentationRequest: PresentationRequest
      }
      this.query = {
        ...queryOf(verifiablePresentationRequest),
        challenge: verifiablePresentationRequest.challenge,
        domain: verifiablePresentationRequest.domain,
      }
      this.verifierKey = envelope.epk
    } catch (error: any) {
      return { status: 400, body: { error: 'invalid_request', error_description: String(error?.message ?? error) } }
    }
    this.state = 'requested'
    this.requestedAt = this.now()
    this.listeners.onRequest?.(this.query)
    return { status: 202, body: { status: 'pending' } }
  }

  private deliver(): HttpAnswer {
    if (this.state === 'answered') {
      const answer = { status: 200, body: { envelope: this.answerEnvelope as unknown as Record<string, unknown> } }
      this.finish('answered')
      return answer
    }
    if (this.state === 'declined') {
      this.finish('declined')
      return { status: 403, body: { status: 'declined' } }
    }
    if (this.state === 'requested') return { status: 202, body: { status: 'pending' } }
    return { status: 409, body: { error: 'no_request' } }
  }

  /** The holder agreed: the presentation goes to the verifier, encrypted to its key. */
  answer(presentation: Presentation) {
    if (this.state !== 'requested' || !this.verifierKey) throw new Error('Nothing to answer')
    this.answerEnvelope = seal(this.key, this.verifierKey, this.id, 'response', {
      verifiablePresentation: presentation,
    })
    this.state = 'answered'
  }

  decline() {
    if (this.state === 'requested') this.state = 'declined'
    else if (this.state === 'waiting') this.finish('declined')
  }

  close() {
    if (this.state !== 'closed') this.finish('closed')
  }
}
