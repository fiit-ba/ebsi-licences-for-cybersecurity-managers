import { decodeJwt } from 'jose'
import type { PresentationData } from '@infrastructure/openid/types'
import { NO_KEYCHAIN_ERROR, readWallet, writeWallet } from './keychain.adapter'
import { addActionLog } from './history.repository'

export const savePresentation = async (signedVpToken: string): Promise<boolean> => {
  const payload = decodeJwt(signedVpToken) as any
  const vp = payload?.vp
  const credentials = Array.isArray(vp?.verifiableCredential)
    ? vp.verifiableCredential
    : vp?.verifiableCredential
      ? [vp.verifiableCredential]
      : []
  if (!vp?.id || credentials.length === 0) throw new Error('Invalid verifiable presentation')

  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  if (wallet.presentations?.some(({ id }) => id === String(vp.id))) return false

  const timestamp = new Date().toISOString()
  const audience = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud
  // An OpenID4VP 1.0 verifier is its client identifier; a DID one is shown as the DID.
  const verifier = String(audience || payload.iss || '').replace(/^decentralized_identifier:/, '')
  const credentialTypes = Array.from(
    new Set<string>(
      credentials.flatMap((credential: unknown) => {
        try {
          const decoded: any = typeof credential === 'string' ? decodeJwt(credential) : credential
          const types = decoded?.vc?.type ?? decoded?.data?.type ?? []
          return (Array.isArray(types) ? types : [types]).filter(
            (type): type is string =>
              typeof type === 'string' &&
              !['VerifiableCredential', 'VerifiableAttestation', 'TrustedCredential'].includes(type),
          )
        } catch {
          return []
        }
      }),
    ),
  )
  const presentation: PresentationData = {
    id: String(vp.id),
    issuer: verifier,
    verifier,
    validFrom: typeof payload.iat === 'number' ? payload.iat : timestamp,
    expirationDate: payload.exp,
    timestamp,
    status: 'Active',
    credential: signedVpToken,
    credentialTypes,
    credentialCount: credentials.length,
  }
  wallet.presentations = [...(wallet.presentations ?? []), presentation]
  addActionLog(wallet, 'Presentation emitted', presentation.id, verifier, timestamp, new Date(timestamp))
  await writeWallet(wallet)
  return true
}

export const getPresentationList = async () => {
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR
  return [...(wallet.presentations?.filter(({ status }) => status === 'Active') ?? [])]
    .map((presentation) => ({ ...presentation, legacy: presentation.legacy ?? !presentation.verifier }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

export const revokePresentations = async (itemIds: Array<Date | string>): Promise<string[]> => {
  const requested = new Set(itemIds.map(String))
  if (!requested.size) return []
  const wallet = await readWallet()
  if (!wallet) throw NO_KEYCHAIN_ERROR

  const revoked: string[] = []
  let changed = false
  for (const presentation of wallet.presentations ?? []) {
    const itemId = String(presentation.timestamp)
    if (!requested.has(itemId)) continue
    revoked.push(itemId)
    if (presentation.status === 'Revoked') continue
    presentation.status = 'Revoked'
    changed = true
    addActionLog(
      wallet,
      'Presentation revoked',
      presentation.id,
      presentation.issuer,
      presentation.validFrom,
      new Date(),
    )
  }
  if (changed) await writeWallet(wallet)
  return revoked
}
