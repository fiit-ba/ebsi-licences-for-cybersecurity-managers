import type { ComponentType } from 'react'

export type OpenIdModalProps = {
  onAccept?: (...args: any[]) => void
  /** Receives a marker when the wallet's lock closed the dialog (app/context/Modal.context.tsx). */
  onCancel?: (reason?: string) => void
  Component?: ComponentType<any>
  modalProps?: unknown
  /** Cancelled when the wallet locks (app/context/Modal.context.tsx). */
  closeOnLock?: boolean
}

export type ModalType = {
  showModal?: (props?: OpenIdModalProps) => void
  t?: (s: string) => string
  showMessage?: (x: { content: string; type: string }) => void
}

// OpenID for Verifiable Credential Issuance 1.0. The separately delivered PIN is the
// transaction code (tx_code); user_pin and user_pin_required belong to its drafts.
export type TxCode = { input_mode?: 'numeric' | 'text'; length?: number; description?: string }

export type Grants = {
  authorization_code?: { issuer_state?: string; authorization_server?: string }
  'urn:ietf:params:oauth:grant-type:pre-authorized_code'?: {
    'pre-authorized_code': string
    tx_code?: TxCode
    authorization_server?: string
  }
}

export type CredentialOffer = {
  credential_issuer: string
  /** Keys of the issuer metadata's credential_configurations_supported. */
  credential_configuration_ids: string[]
  grants: Grants
}

export type Display = { name: string; locale?: string }

export type CredentialConfiguration = {
  format: string
  scope?: string
  cryptographic_binding_methods_supported?: string[]
  credential_signing_alg_values_supported?: string[]
  proof_types_supported?: Record<string, { proof_signing_alg_values_supported: string[] }>
  credential_definition?: { type: string[] }
  credential_metadata?: { display?: Display[] }
}

export type OpenIdCredentialIssuer = {
  credential_issuer: string
  authorization_servers?: string[]
  credential_endpoint: string
  nonce_endpoint?: string
  deferred_credential_endpoint?: string
  display?: Display[]
  credential_configurations_supported: Record<string, CredentialConfiguration>
}

/** A credential the holder may choose in an offer: its configuration, by id. */
export type OfferedCredential = CredentialConfiguration & { id: string; types: string[] }

export type OpenIdConfiguration = {
  redirect_uris: string[]
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  scopes_supported: string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  subject_types_supported: string[]
  id_token_signing_alg_values_supported: string[]
  request_object_signing_alg_values_supported: string[]
  request_parameter_supported: boolean
  request_uri_parameter_supported: boolean
  token_endpoint_auth_methods_supported: string[]
  request_authentication_methods_supported: Record<string, string[]>
  vp_formats_supported: Record<string, { alg_values_supported: string[] }>
  subject_syntax_types_supported: string[]
  subject_syntax_types_discriminations: string[]
  subject_trust_frameworks_supported: string[]
  id_token_types_supported: string[]
}

// The Credential Response: the credentials, or a transaction id to ask the deferred endpoint with.
export type CredentialResponse = {
  credentials?: Array<{ credential: string }>
  transaction_id?: string
  interval?: number
  notification_id?: string
}

export type AuthorizationRequest = {
  response_type: 'code'
  client_id: string
  redirect_uri: string
  scope: string
  issuer_state?: string
  state?: string
  authorization_details: string
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'S256' | 'plain'
  client_metadata?: string
}

export type HolderServiceWalletMetadata = {
  authorization_endpoint: string
  response_types_supported: string[]
  vp_formats_supported: Record<string, { alg_values: string[] }>
}

export type AuthorizationDetail = {
  type: 'openid_credential'
  locations?: string[]
  credential_configuration_id: string
}

export type AuthorizationResponse = { code: string; state?: string }
export type GrantType = 'urn:ietf:params:oauth:grant-type:pre-authorized_code' | 'preauthorized_code'
export type TokenRequest = {
  grant_type: GrantType | 'authorization_code'
  redirect_uri?: string
  client_id?: string
  code?: string
  code_verifier?: string
  tx_code?: string
  'pre-authorized_code'?: string
}
// No c_nonce: OpenID4VCI 1.0 issues it from the Nonce Endpoint.
export type TokenResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  authorization_details?: unknown[]
}
// A credential the issuer will deliver later: asked for with its transaction id and the access token.
export type DeferredCredential = {
  credential_endpoint: string
  transaction_id: string
  access_token: string
  issuerUri?: string
}
