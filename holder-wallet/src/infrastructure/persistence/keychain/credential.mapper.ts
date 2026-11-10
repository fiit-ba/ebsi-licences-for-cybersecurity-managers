import { decodeJwt } from 'jose'
import type { CredentialData } from '@infrastructure/openid/types'

export const toStoredCredential = (credential: unknown): CredentialData => {
  if (!credential) throw new Error('Credential is undefined')

  let credentialObject: any
  if (typeof credential === 'string' && credential.startsWith('ey')) {
    credentialObject = decodeJwt(credential).vc
  } else {
    const parsed = typeof credential === 'string' ? JSON.parse(credential) : credential
    credentialObject = parsed?.vc ?? parsed?.payload?.vc ?? parsed
  }

  const lacchain = credentialObject.data?.issuer?.startsWith('did:lac')
  const data = lacchain ? credentialObject.data : credentialObject
  return {
    id: data.id,
    issuer: typeof data.issuer === 'string' ? data.issuer : data.issuer?.id,
    validFrom: data.validFrom ?? data.issuanceDate ?? data.issued,
    expirationDate: data.expirationDate ?? data.validUntil,
    timestamp: new Date().toISOString(),
    status: 'Active',
    credential,
  } as unknown as CredentialData
}
