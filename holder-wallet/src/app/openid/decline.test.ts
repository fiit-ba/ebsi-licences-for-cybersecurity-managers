// Declining a presentation request: the verifier is told at once (OpenID4VP 1.0
// error response access_denied, sent to response_uri) - unless it was the wallet's
// lock that closed the dialog, after which the holder may still answer.
import { CLOSED_BY_LOCK } from '@app/context/Modal.context'
import OpenIdService from '@infrastructure/openid/OpenIdService'
import { postPresentationResponse } from '@infrastructure/openid/openid.client'
import { PresentationDeclined, issuePresentation } from './issuePresentation'

jest.mock('@infrastructure/openid/openid.client', () => ({
  ...jest.requireActual('@infrastructure/openid/openid.client'),
  postPresentationResponse: jest.fn(async () => ({ status: 200 })),
}))

const posted = postPresentationResponse as jest.Mock
const REQUEST = {
  client_id: 'decentralized_identifier:did:ebsi:zVerifier',
  nonce: 'n-1',
  state: 'state-1',
  response_uri: 'http://verifier.test/auth/direct_post',
  dcql_query: { credentials: [{ id: 'q', format: 'jwt_vc_json', claims: [] }] },
}

const answer = async (closeWith?: typeof CLOSED_BY_LOCK) => {
  jest.spyOn(OpenIdService, 'getPresentationRequest').mockResolvedValue(REQUEST as any)
  const showModal = (props: any) => props.onCancel(closeWith)
  return issuePresentation('openid4vp://?request_uri=x', { t: (key: string) => key, showModal })
}

describe('declining a presentation request', () => {
  beforeEach(() => posted.mockClear())

  it('tells the verifier with access_denied and the request state', async () => {
    await expect(answer()).rejects.toBeInstanceOf(PresentationDeclined)
    expect(posted).toHaveBeenCalledTimes(1)
    const [url, body] = posted.mock.calls[0]
    expect(url).toBe(REQUEST.response_uri)
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({ error: 'access_denied', state: 'state-1' })
  })

  it('sends nothing when the wallet locked and closed the dialog', async () => {
    const declined = answer(CLOSED_BY_LOCK)
    await expect(declined).rejects.toMatchObject({ byLock: true })
    expect(posted).not.toHaveBeenCalled()
  })

  it('still reports the decline when the verifier cannot be reached', async () => {
    posted.mockRejectedValueOnce(new Error('Network Error'))
    await expect(answer()).rejects.toBeInstanceOf(PresentationDeclined)
  })
})
