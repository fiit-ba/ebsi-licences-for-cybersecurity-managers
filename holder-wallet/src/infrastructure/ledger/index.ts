// A certificate's record, read from the certificate registry (design decisions
// D30, D36) through EBSI's Ledger API: an `eth_call` of `certificateStatus`,
// no transaction and no key. The record is the only source of truth about the
// certificate - the TI that issued it, the hash of the very credential the
// holder collected, when it is valid from and until, and its standing. It is
// kept under a key anyone computes from the TI's DID and the credential's id,
// so the credential names only the registry (D34). What the wallet's verifier
// asks when the back-office is not there to ask (D33), and what the holder's
// wallet asks about its own certificates.
import '@ethersproject/shims'
import { utils } from 'ethers'
import { fetchWithin } from '@infrastructure/network/http'
import { certificates, ebsi } from '@infrastructure/config/Ebsi'

const ABI = [
  'function certificateStatus(bytes32 statusKey) view returns (tuple(uint8 standing, uint64 validFrom, uint64 validUntil, uint64 registeredAt, uint64 changedAt, bytes32 credentialHash, string issuerDid))',
]
const contractInterface = new utils.Interface(ABI)

/** The registry's Standing enum, by index. */
export const STANDINGS = ['none', 'valid', 'suspended', 'revoked'] as const
export type Standing = (typeof STANDINGS)[number]

export type CertificateRecord = {
  standing: Standing
  /** The DID of the TI that issued it. */
  issuerDid: string
  /** SHA-256 of the collected credential's signed JWT, 0x-hex. */
  credentialHash: string
  /** Unix times; validUntil 0 when the certificate does not expire. */
  validFrom: number
  validUntil: number
  registeredAt: number
  changedAt: number
}

export class LedgerUnavailable extends Error {}

/** The `credentialStatus` entry a certificate names its registry by (design decisions D34). */
export const LEDGER_STATUS_ENTRY = 'PlrLedgerStatusEntry'

export type LedgerStatusEntry = {
  id: string
  type: typeof LEDGER_STATUS_ENTRY
  chainId: number
  contract: string
}

/** The registry a W3C credential names, if it names one well-formed. */
export const ledgerEntryOf = (vc: any): LedgerStatusEntry | undefined =>
  ([] as any[])
    .concat(vc?.credentialStatus ?? [])
    .find(
      (entry) =>
        entry?.type === LEDGER_STATUS_ENTRY &&
        typeof entry.contract === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(entry.contract),
    )

const abi = utils.defaultAbiCoder

/**
 * The key a certificate's record is kept under: SHA-256(abi.encode("PLR-CERTIFICATE-V4", TI DID,
 * SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", vc.id)))), as the registry's `computeStatusKey`.
 */
export const statusKeyOf = (issuerDid: string, certificateId: string): string =>
  utils.sha256(
    abi.encode(
      ['string', 'string', 'bytes32'],
      [
        'PLR-CERTIFICATE-V4',
        issuerDid,
        utils.sha256(abi.encode(['string', 'string'], ['PLR-CERTIFICATE-ID-V1', certificateId])),
      ],
    ),
  )

/** The hash the registry records of a credential: SHA-256 of its signed JWT, before any `~`. */
export const credentialHashOf = (credential: string): string =>
  utils.sha256(utils.toUtf8Bytes(String(credential).split('~')[0]))

/** The issuer a W3C credential states. */
const issuerOf = (vc: any): string => (typeof vc?.issuer === 'string' ? vc.issuer : vc?.issuer?.id)

/** The record key of a certificate, from what it states: its issuer and its id. */
export const statusKeyOfCredential = (vc: any): string | undefined => {
  const issuer = issuerOf(vc)
  return typeof issuer === 'string' && issuer && typeof vc?.id === 'string' && vc.id
    ? statusKeyOf(issuer, vc.id)
    : undefined
}

/** How long a read of the record may take; on a slow connection a record
 * that does arrive must not read as unavailable (at least 30 s). */
export const TIMEOUT_MS = 30000

/** The record kept under `statusKey`, on the configured certificate registry. */
export const readCertificateStatus = async (statusKey: string, signal?: AbortSignal): Promise<CertificateRecord> => {
  const contract = certificates.registry()
  if (!ebsi.isConfigured() || !contract) throw new LedgerUnavailable('No ledger or certificate registry configured')
  const data = contractInterface.encodeFunctionData('certificateStatus', [statusKey])
  let body: any
  try {
    body = await fetchWithin(
      ebsi.ledger(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data }, 'latest'] }),
      },
      TIMEOUT_MS,
      (response) => response.json(),
      signal,
    )
  } catch (error: any) {
    throw new LedgerUnavailable(String(error?.message ?? error))
  }
  if (body?.error || typeof body?.result !== 'string') {
    throw new LedgerUnavailable(String(body?.error?.message ?? 'No result from the ledger'))
  }
  const [record] = contractInterface.decodeFunctionResult('certificateStatus', body.result)
  return {
    standing: STANDINGS[Number(record.standing)] ?? 'none',
    issuerDid: String(record.issuerDid),
    credentialHash: String(record.credentialHash).toLowerCase(),
    validFrom: Number(record.validFrom),
    validUntil: Number(record.validUntil),
    registeredAt: Number(record.registeredAt),
    changedAt: Number(record.changedAt),
  }
}

const seconds = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)
}

/**
 * What the record states otherwise than the certificate - its TI, the hash of
 * the credential itself, or its dates (D36). A certificate whose record is not
 * its own borrows another's standing, or outlives the dates the registry
 * recorded: it is not judged by that record.
 * @param credential - The credential as issued or presented (its JWT, with or without `~` disclosures).
 */
export const recordDiffers = (record: CertificateRecord, vc: any, credential: string): string[] => {
  const stated: Record<string, unknown> = {
    issuer: issuerOf(vc),
    credentialHash: credentialHashOf(credential),
    validFrom: seconds(vc?.validFrom ?? vc?.issuanceDate),
    validUntil: seconds(vc?.validUntil ?? vc?.expirationDate),
  }
  const recorded: Record<string, unknown> = {
    issuer: record.issuerDid,
    credentialHash: record.credentialHash,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
  }
  return Object.keys(stated).filter((name) => stated[name] !== recorded[name])
}
