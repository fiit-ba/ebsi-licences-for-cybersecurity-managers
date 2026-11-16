import type { JwtHeader, JwtPayload } from 'jsonwebtoken'

export type TrustedFramework = 'lacchain' | 'alastria' | 'ebsi'
export type StoredItemStatus = 'Active' | 'Suspended' | 'Revoked'

export type CredentialData = {
  id: string
  issuer: string
  validFrom: any
  expirationDate: any
  timestamp?: Date
  credential: Credential
  status: StoredItemStatus
  issuerUri?: string
}

export type Vc = {
  '@context': string[]
  id: string
  type: string[]
  credentialSchema: { id: string; type: string }
  credentialSubject: { id: string }
  validFrom?: string
  validUntil?: string
  expirationDate?: string
  issuanceDate: string
  issuer: string
  issued?: string
  credentialStatus?: W3CCredentialStatus
  proof?: EmbeddedProof
  [key: string]: any
}

export interface EmbeddedProof {
  id?: string
  type: string
  proofPurpose: string
  verificationMethod: string
  created?: string
  expires?: string
  domain?: string
  challenge?: string
  proofValue: string
  previousProof?: string | string[]
  nonce?: string
}

export interface W3CCredentialStatus {
  id?: string
  type: string
  [key: string]: any
}

export interface StatusListEntry2021 {
  id: string
  type: 'StatusList2021Entry'
  statusPurpose: 'revocation' | 'suspension'
  statusListIndex: string
  statusListCredential: string
}

export type CredentialStatusEntry = StatusListEntry2021
export type CredentialStatusState = 'valid' | 'suspended' | 'revoked' | 'expired' | 'unknown'
export interface CredentialStatusResult {
  valid: boolean
  state: CredentialStatusState
  error?: string
}
export interface StatusListCredentialData {
  id: string
  type: 'StatusList2021'
  statusPurpose: 'revocation' | 'suspension'
  encodedList: string
}

export type Credential = { header: JwtHeader; payload: JwtPayload & { vc: Vc } }
export type chosenCredential = {
  format: 'jwt_vc' | 'ldp_vc'
  trust_framework: { name: string; type: string; uri: string }
  types: ['VerifiableCredential', 'VerifiableAttestation', string]
}

export type PresentationData = {
  id: string
  issuer: string
  validFrom: any
  expirationDate: any
  timestamp: Date | string
  credential: Credential | string
  verifier?: string
  credentialTypes?: string[]
  credentialCount?: number
  legacy?: boolean
  status: StoredItemStatus
}

export type ActionLog = {
  id: string
  actionType:
    | 'Credential added'
    | 'Credential expired'
    | 'Credential revoked'
    | 'Credential suspended'
    | 'Credential reinstated'
    | 'Presentation emitted'
    | 'Presentation revoked'
    | 'Certificate verified'
    | 'Certificate issued'
  issuer: string
  date: Date | string
  data?: any
}
