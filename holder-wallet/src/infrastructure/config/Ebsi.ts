// Where EBSI's APIs are, for what the wallet checks without the back-office
// (design decisions D33), and which certificate registry records the
// certificates' standing (D30). Read at build time from .env, like BACKOFFICE_URL.
// EBSI_API says which shape of EBSI's APIs is below that URL: `pilot` (the default), as EBSI's
// pilot network serves them (DID Registry v5, Trusted Issuers Registry v5, Trusted Schemas
// Registry v3, Ledger API v4), or `core-v1`, every API under /v1.
// The verifier trusts these, not what a certificate names: the certificate is
// shown by its holder, and a ledger or a contract it pointed at could say
// anything.

const base = (): string => String(process.env.EBSI_URL ?? '').replace(/\/+$/, '')
const pilot = (): boolean => (process.env.EBSI_API ?? 'pilot') !== 'core-v1'

export const ebsi = {
  isConfigured: (): boolean => Boolean(base()),
  didRegistry: (): string => `${base()}${pilot() ? '/did-registry/v5' : '/v1/did-registry'}`,
  trustedIssuersRegistry: (): string =>
    `${base()}${pilot() ? '/trusted-issuers-registry/v5' : '/v1/issuers-registry'}`,
  trustedSchemasRegistry: (): string =>
    `${base()}${pilot() ? '/trusted-schemas-registry/v3' : '/v1/schemas-registry'}`,
  ledger: (): string => `${base()}${pilot() ? '/ledger/v4/blockchains/besu' : '/v1/ledger'}`,
}

/** Where a Trusted Issuers Registry's paths start, in either shape: a link names one of them. */
export const issuersRegistryMarkers = ['/trusted-issuers-registry/v5/', '/v1/issuers-registry/']

/** The EBSI Support Office, the one issuer a RootTAO's authorisation is accepted from. */
export const supportOfficeDid = (): string => String(process.env.EBSI_SUPPORT_OFFICE_DID ?? '')

/**
 * Where certificates' records are. Each TAO has its own certificate registry; the wallet
 * recognises one by EBSI's Proxy Factory (EBSI_PROXY_FACTORY) and the templates it was deployed
 * from (CONTRACT_TEMPLATES), and checks that it is the TAO's that accredited the issuer.
 * CERTIFICATE_REGISTRY is the one registry trusted when no factory is configured.
 */
export const certificates = {
  registry: (): string => String(process.env.CERTIFICATE_REGISTRY ?? '').toLowerCase(),
  factory: (): string => String(process.env.EBSI_PROXY_FACTORY ?? '').toLowerCase(),
  templates: (): { registry: { name: string; version: string }; governance: { name: string; version: string } } => {
    const [registry, governance] = String(
      process.env.CONTRACT_TEMPLATES || 'CertificateRegistry@1,CertificateGovernance@1',
    )
      .split(',')
      .map((part) => {
        const [name, version] = part.trim().split('@')
        return { name, version }
      })
    return { registry, governance }
  },
  chainId: (): number => Number(process.env.LEDGER_CHAIN_ID ?? 0) || 0,
}
