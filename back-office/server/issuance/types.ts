import type { PoolClient } from 'pg';
import type { JWK } from 'jose';
import type { Protection } from './protection.ts';

/** A collected certificate's record, as the certificate registry keeps it. */
export interface LedgerRegistration {
  /** The collected credential's `vc.id`; the registry keeps only its hash. */
  id: string;
  issuer: string;
  /** SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuer, certificateIdHash)), 0x-hex. */
  statusKey: string;
  /** SHA-256 of the signed JWT, 0x-hex. */
  credentialHash: string;
  validFrom: number;
  validUntil: number;
  standing?: 'active' | 'suspended' | 'revoked';
}

/** Certificate record returned by the certificate registry (`Certificate`). */
export interface LedgerStatus {
  standing: bigint;
  validFrom: bigint;
  validUntil: bigint;
  registeredAt?: bigint;
  changedAt?: bigint;
  credentialHash: string;
  issuerDid: string;
}

/** The certificate registry: its deployment and registration/status operations. */
export interface CertificateLedger {
  chainId: number;
  contract: string;
  ensureRegistered(record: LedgerRegistration): Promise<unknown>;
  status(statusKey: string): Promise<LedgerStatus>;
}

/** Issuer trust check with optional exact accreditation and schema binding. */
export type IssuerTrustCheck = (
  did: string,
  type: string,
  options: { attribute?: string; schemaId?: string },
) => Promise<unknown>;

/** Registered certificate fields required to finalize holder-bound issuance. */
export interface FinalizationRecord {
  id: string;
  issuer_id: string;
  issuer_did: string;
  credential_id: string;
  credential_type: string;
  certificate_number: string;
  created_at: Date;
  valid_from?: Date | null;
  valid_until?: Date | null;
  tsr_id: string;
  tir_attribute_id: string;
  local_standing?: 'active' | 'suspended' | 'revoked';
}

/** Published issuer key whose implementation retains the private key externally. */
export interface CredentialSigningKey {
  kid: string;
  publicJwk?: JWK;
  sign(input: Buffer): Promise<Uint8Array> | Uint8Array;
}

/** Registry authorization-server key used for ES256 access tokens and request objects. */
export interface AuthorizationSigning {
  /** The registry's DID, which names it as an OpenID4VP verifier. */
  did?: string;
  key(client?: PoolClient): Promise<CredentialSigningKey & { publicJwk: JWK }>;
  publicKeys(): Promise<JWK[]>;
}

/** Existing issuer dependencies, including its separate registry authorization-server identity. */
export type IssuerOptions = RegistrationOptions &
  FinalizerOptions & {
    authorization: AuthorizationSigning;
  };

/** Loader for the current published TI credential-signing key. */
export type CredentialKeyLoader = (
  issuer: string,
  organization: string,
  client?: PoolClient,
) => Promise<CredentialSigningKey>;

/** Dependencies required by the existing certificate finalization pipeline. */
export interface FinalizerOptions {
  signingKey: CredentialKeyLoader;
  ledger: Pick<CertificateLedger, 'chainId' | 'contract' | 'ensureRegistered'>;
  protection: Protection;
  schemaAddress(id: string): string;
  ledgerStatusSchema: string;
  accreditationAddress(did: string, attribute: string): string;
  ensureAccredited?: IssuerTrustCheck;
  validateCredential?: (credential: unknown, references: { id: string }[]) => Promise<void>;
  now?: () => Date;
}

/** Validated identity and claims passed to the credential finalizer. */
export interface FinalizationInput {
  certificate: FinalizationRecord;
  claims: Record<string, unknown>;
  subject: string;
  client?: PoolClient;
}

/** Dependencies for storing an encrypted certificate and its holder offer. */
export interface RegistrationOptions {
  publicOrigin: string;
  protection: Protection;
  ensureAccredited: IssuerTrustCheck;
  schemaAddress?: (id: string) => string;
  ensureIssuer?: (organization: string, actor: number) => Promise<void>;
}

/** Existing OAuth and credential success/refusal fields returned by issuance endpoints. */
export interface IssuanceProtocolBody {
  error?: string;
  error_description?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  credentials?: { credential: string }[];
}

/** HTTP-compatible issuance result with the existing protocol fields in its JSON body. */
export interface IssuanceProtocolResult {
  status: number;
  body: IssuanceProtocolBody;
}

/** Trusted issuer assertion-key resolver with an optional historical observation time. */
export type AssertionKeyResolver = (did: string, kid: string, at?: Date) => Promise<JWK>;
