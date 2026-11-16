// Presenting certificates with OpenID for Verifiable Presentations 1.0. The
// verifier's request comes by reference (request_uri), signed with a key of
// the DID its client identifier names; it asks with a DCQL query. The holder
// chooses the certificates and, of the claim combinations the verifier
// accepts, which to share; each certificate goes in its own presentation,
// signed by the binding key it is bound to (design decisions D34), for the
// request's nonce and the verifier's client identifier. The answer is a
// vp_token - presentations by credential query id - posted to response_uri.
import RequestPresentationModal from '@features/presentations/components/RequestPresentationModal'
import { signJWT } from '@infrastructure/crypto/jwt'
import { savePresentation } from '@infrastructure/persistence/keychain'
import { bindingOfCredentials } from '@infrastructure/identity/binding/binding.service'
import OpenIdService from '@infrastructure/openid/OpenIdService'
import openIdI18nKeys from '@app/localization/i18n/keys'
import { DcqlAnswer, ModalType, PresentationRequest } from '@infrastructure/openid/types'
import { createVp, getTrustedFrameworkFromDid } from '@infrastructure/openid/utils'
import { CLOSED_BY_LOCK } from '@app/context/Modal.context'

/**
 * The holder closed the request without presenting. `byLock`: the wallet's lock closed
 * it, which is no refusal - the holder may open the link again after unlocking.
 */
export class PresentationDeclined extends Error {
  constructor(
    message: string,
    readonly byLock = false,
  ) {
    super(message)
  }
}

/** How long a presentation is accepted after it is signed (the verifier allows 15 minutes). */
const PRESENTATION_SECONDS = 600

/**
 * Ask the holder what to present for a request, and sign it: one presentation per
 * certificate, keyed by the credential query it answers.
 */
export const presentFor = async (
  request: Pick<PresentationRequest, 'client_id' | 'nonce' | 'dcql_query' | 'client_metadata'>,
  { t, showModal }: ModalType,
): Promise<{ vpToken: Record<string, string[]>; presentations: string[] }> => {
  if (!t) throw new Error('Error translating')
  const answers = await new Promise<DcqlAnswer[]>((resolve, reject) =>
    showModal?.({
      Component: RequestPresentationModal,
      modalProps: { dcqlQuery: request.dcql_query, verifier: request.client_metadata?.client_name },
      // It lists the holder's licences: closed when the wallet locks.
      closeOnLock: true,
      onAccept: resolve,
      onCancel: (reason) =>
        reject(new PresentationDeclined(t(openIdI18nKeys.ERROR_CANCEL_PRESENTATION), reason === CLOSED_BY_LOCK)),
    }),
  )
  const vpToken: Record<string, string[]> = {}
  const presentations: string[] = []
  for (const answer of answers) {
    const { did, privateKey } = await bindingOfCredentials([answer.credential])
    const now = Math.floor(Date.now() / 1000)
    const signed = await signJWT({
      header: { typ: 'JWT', kid: did },
      trustedFramework: getTrustedFrameworkFromDid(did),
      payload: {
        iss: did,
        sub: did,
        aud: request.client_id,
        nonce: request.nonce,
        iat: now,
        nbf: now,
        exp: now + PRESENTATION_SECONDS,
        vp: createVp({ holder: did, verifiableCredential: [answer.credential] }),
      },
      privateKey,
    })
    ;(vpToken[answer.queryId] ??= []).push(signed)
    presentations.push(signed)
  }
  return { vpToken, presentations }
}

/** Answer a verifier's `openid4vp://` request: verify it, ask the holder, post the vp_token. */
export const issuePresentation = async (uri: string, { t, showModal }: ModalType) => {
  if (!t) throw new Error('Error translating')
  const request = await OpenIdService.getPresentationRequest(uri)
  let answer: Awaited<ReturnType<typeof presentFor>>
  try {
    answer = await presentFor(request, { t, showModal })
  } catch (error) {
    // Declined: the verifier is told at once (access_denied) instead of waiting for
    // the request to expire. Not when the wallet locked - the holder may come back.
    // Best effort, in the background: the holder is not kept waiting on a slow network.
    if (error instanceof PresentationDeclined && !error.byLock)
      void OpenIdService.sendPresentationError({ request, error: 'access_denied' })
    throw error
  }
  const { vpToken, presentations } = answer
  if (!(await OpenIdService.sendPresentationResponse({ request, vpToken })))
    throw new Error(t(openIdI18nKeys.PRESENTATION_REFUSED))
  // Persist the unique signed VP events, not more copies of their source certificates.
  for (const presentation of presentations) await savePresentation(presentation)
  return t(openIdI18nKeys.SUCCESS_PRESENTATION)
}
