// OpenID for Verifiable Presentations 1.0: what a verifier asks for, as a DCQL query
// (section 6), and the signed request object that carries it. Presentation Exchange
// (presentation_definition and presentation_submission) belongs to its drafts.
import type { DcqlQuery } from '@domain/credentials/dcql'

export type { DcqlClaim, DcqlCredentialQuery, DcqlQuery } from '@domain/credentials/dcql'

export type PresentationRequest = {
  client_id: string
  response_type: 'vp_token'
  response_mode: 'direct_post'
  response_uri: string
  nonce: string
  state?: string
  dcql_query: DcqlQuery
  client_metadata?: { client_name?: string; vp_formats_supported?: Record<string, unknown> }
  aud?: string
  iss?: string
  exp?: number
  iat?: number
}

/** One presented credential, for the credential query it answers. */
export type DcqlAnswer = { queryId: string; credential: string }

export type AuthorizationRequestResponse = {
  client_id: string
  key: string
  nonce: string
  redirect_uri: string
  request_uri: string
  response_mode: string
  response_type: string
  scope: string
  dcql_query?: DcqlQuery
  request: string
  error: string
  error_description: string
}
