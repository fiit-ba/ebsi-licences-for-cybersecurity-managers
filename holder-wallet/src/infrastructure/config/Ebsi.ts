// Where EBSI's APIs are, for what the wallet checks without the back-office
// (design decisions D33), and which certificate registry records the
// certificates' standing (D30). Read at build time from .env, like BACKOFFICE_URL.
// EBSI's Core API v1: every API under /v1 of the one base URL.
// The verifier trusts these, not what a certificate names: the certificate is
// shown by its holder, and a ledger or a contract it pointed at could say
// anything.

const base = (): string => String(process.env.EBSI_URL ?? '').replace(/\/+$/, '')

export const ebsi = {
  isConfigured: (): boolean => Boolean(base()),
  didRegistry: (): string => `${base()}/v1/did-registry`,
  trustedIssuersRegistry: (): string => `${base()}/v1/issuers-registry`,
  trustedSchemasRegistry: (): string => `${base()}/v1/schemas-registry`,
  ledger: (): string => `${base()}/v1/ledger`,
}

/** The EBSI Support Office, the one issuer a RootTAO's authorisation is accepted from. */
export const supportOfficeDid = (): string => String(process.env.EBSI_SUPPORT_OFFICE_DID ?? '')

/** The certificate registry that keeps every certificate's record, and its chain. */
export const certificates = {
  registry: (): string => String(process.env.CERTIFICATE_REGISTRY ?? '').toLowerCase(),
  chainId: (): number => Number(process.env.LEDGER_CHAIN_ID ?? 0) || 0,
}
