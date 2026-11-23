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

/** An `eth_call` through EBSI's Ledger API. */
const ethCall = async (to: string, data: string, signal?: AbortSignal): Promise<string> => {
  if (!ebsi.isConfigured()) throw new LedgerUnavailable('No ledger configured')
  let body: any
  try {
    body = await fetchWithin(
      ebsi.ledger(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
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
  return body.result
}

const pairInterface = new utils.Interface([
  'function getDeploymentInfo(address) view returns (tuple(bytes32 templateId, address deployer, uint256 deploymentTimestamp, bool isActive, string deployerDID, address owner))',
  'function governance() view returns (address)',
  'function certificateRegistry() view returns (address)',
  'function taoDid() view returns (string)',
])

/** A template's id in EBSI's Proxy Templates Registry: keccak256(abi.encode(name, version)). */
const templateId = (template: { name: string; version: string }): string =>
  utils.keccak256(utils.defaultAbiCoder.encode(['string', 'string'], [template.name, template.version]))

/** A registry a certificate names that is not a genuine registry of its TI's TAO. */
export class UntrustedRegistry extends Error {}

const recognised = new Map<string, Promise<string>>()

/**
 * The TAO a certificate registry serves, when it is genuine: EBSI's Proxy Factory deployed it from
 * the certificate registry template, its governance from the governance template, and the two
 * name each other. Each TAO has its own; the wallet needs no list of them.
 */
export const registryTao = (contract: string, signal?: AbortSignal): Promise<string> => {
  const registry = contract.toLowerCase()
  let tao = recognised.get(registry)
  if (!tao) {
    tao = (async () => {
      const factory = certificates.factory()
      if (!factory) throw new UntrustedRegistry('No EBSI Proxy Factory is configured')
      const call = async (to: string, name: string, args: unknown[] = []) =>
        pairInterface.decodeFunctionResult(name, await ethCall(to, pairInterface.encodeFunctionData(name, args), signal))
      const deployedFrom = async (address: string, template: { name: string; version: string }) => {
        const [info] = await call(factory, 'getDeploymentInfo', [address])
        return String(info.templateId).toLowerCase() === templateId(template) && info.isActive === true
      }
      const templates = certificates.templates()
      if (!(await deployedFrom(registry, templates.registry)))
        throw new UntrustedRegistry('The registry was not deployed from the registry template')
      const [governance] = await call(registry, 'governance')
      if (!(await deployedFrom(governance, templates.governance)))
        throw new UntrustedRegistry('Its governance was not deployed from the governance template')
      const [governed] = await call(governance, 'certificateRegistry')
      if (String(governed).toLowerCase() !== registry)
        throw new UntrustedRegistry('Its governance governs another registry')
      const [did] = await call(governance, 'taoDid')
      return String(did)
    })()
    recognised.set(registry, tao)
    // A failed check is asked again next time, not remembered.
    tao.catch(() => recognised.delete(registry))
  }
  return tao
}

/**
 * Whether a registry is the one of the TAO that accredited the certificate's TI. Without an EBSI
 * Proxy Factory configured, only the configured registry is.
 */
export const trustRegistry = async (contract: string, taoDid: string | undefined, signal?: AbortSignal) => {
  if (!certificates.factory()) {
    if (!certificates.registry() || contract.toLowerCase() !== certificates.registry())
      throw new UntrustedRegistry('The certificate names another certificate registry')
    return
  }
  if (!taoDid) throw new UntrustedRegistry("The certificate's TI has no accrediting TAO")
  if ((await registryTao(contract, signal)) !== taoDid)
    throw new UntrustedRegistry("The certificate registry is not its TI's TAO's")
}

/**
 * What the status entry's schema leaves to the verifier (licence-status-entry 1.0.0): the entry's
 * id is the CAIP-10 account of its own chain and contract, the chain is the EBSI ledger's this
 * wallet reads (LEDGER_CHAIN_ID), and the contract is the registry of the TAO that accredited the
 * certificate's TI ({@link trustRegistry}).
 */
export const trustLedgerEntry = async (entry: LedgerStatusEntry, taoDid: string | undefined, signal?: AbortSignal) => {
  if (String(entry.id).toLowerCase() !== `eip155:${entry.chainId}:${entry.contract}`.toLowerCase())
    throw new UntrustedRegistry('The status entry does not name its own chain and contract')
  const chainId = certificates.chainId()
  if (!chainId) throw new UntrustedRegistry('No EBSI ledger chain is configured')
  if (entry.chainId !== chainId)
    throw new UntrustedRegistry(`The certificate registry is on chain ${entry.chainId}, not on the EBSI ledger`)
  await trustRegistry(entry.contract, taoDid, signal)
}

/** The record kept under `statusKey`, on the certificate registry the certificate names. */
export const readCertificateStatus = async (
  statusKey: string,
  signal?: AbortSignal,
  contract: string = certificates.registry(),
): Promise<CertificateRecord> => {
  if (!ebsi.isConfigured() || !contract) throw new LedgerUnavailable('No ledger or certificate registry configured')
  const data = contractInterface.encodeFunctionData('certificateStatus', [statusKey])
  const [record] = contractInterface.decodeFunctionResult('certificateStatus', await ethCall(contract, data, signal))
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
