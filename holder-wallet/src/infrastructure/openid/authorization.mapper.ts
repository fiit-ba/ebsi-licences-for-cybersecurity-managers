import type { AuthorizationDetail, AuthorizationRequest, HolderServiceWalletMetadata } from './types'

export type AuthorizationRequestInput = {
  issuerState?: string
  subjectDid: string
  challenge: string
  /** The offered credential, by its id in the issuer metadata (OpenID4VCI 1.0, section 5.1.1). */
  credentialConfigurationId: string
  locations: string
  scope: string[]
}

export const buildAuthorizationRequest = (input: AuthorizationRequestInput, state: string): AuthorizationRequest => ({
  response_type: 'code',
  scope: input.scope.join(' '),
  state,
  client_id: input.subjectDid,
  authorization_details: JSON.stringify([
    {
      type: 'openid_credential',
      locations: [input.locations],
      credential_configuration_id: input.credentialConfigurationId,
    } as AuthorizationDetail,
  ]),
  client_metadata: JSON.stringify({
    vp_formats_supported: {
      jwt_vc_json: { alg_values: ['ES256'] },
    },
    response_types_supported: ['vp_token', 'id_token'],
    authorization_endpoint: 'openid4vp://',
  } as HolderServiceWalletMetadata),
  code_challenge: input.challenge,
  code_challenge_method: 'S256',
  nonce: 'glkFFoisdfEui4312',
  redirect_uri: 'openid://callback',
  ...(input.issuerState ? { issuer_state: input.issuerState } : {}),
})
