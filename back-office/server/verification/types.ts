import type { JWTPayload } from 'jose';
import type { AssertionKeyResolver, CertificateLedger } from '../issuance/types.ts';

/** Existing credential status reference, including explicitly enrolled historical lists. */
export interface CredentialStatusEntry {
  id?: string;
  type: string;
  chainId?: number;
  contract?: string;
  statusKey?: string;
  statusListCredential?: string;
  statusPurpose?: string;
  statusListIndex?: string;
  statusSize?: number;
}

/** Existing schema or accreditation reference carried by a credential. */
export interface CredentialReference {
  id: string;
  type: string;
}

/** Expected credential document inspected by the existing runtime validation pipeline. */
export interface CredentialDocument {
  id: string;
  issuer: string;
  type: string[];
  issuanceDate: string;
  issued?: string;
  validFrom: string;
  validUntil: string;
  expirationDate: string;
  credentialSubject: Record<string, unknown> & {
    id: string;
    accreditedFor?: { schemaId: string; types: string[] }[];
  };
  credentialStatus: CredentialStatusEntry | CredentialStatusEntry[];
  credentialSchema: CredentialReference | CredentialReference[];
  termsOfUse: CredentialReference | CredentialReference[];
}

/** JWT payload decoded before its credential signature and invariants are checked. */
export interface CredentialPayload extends JWTPayload {
  vc: CredentialDocument;
}

/** Identity and disclosed claims returned only after successful credential verification. */
export interface VerifiedCredential {
  credentialId: string;
  issuer: string;
  subject: string;
  type: string;
  claims: Record<string, unknown>;
  statusKey: string | null;
}

/** Existing credential verification constraints supplied by a presentation. */
export interface CredentialConstraints {
  expectedHolder?: string;
  credentialTypes?: string[];
  now?: Date;
}

/** Holder-bound credential verification operation. */
export type VerifyCredential = (
  value: string,
  options?: CredentialConstraints,
) => Promise<VerifiedCredential>;

/** Trusted adapters used by the existing credential verification pipeline. */
export interface CredentialVerifierOptions {
  assertionKey: AssertionKeyResolver;
  checkAccreditation(
    did: string,
    type: string,
    options: { reference: string; schemaId: string },
  ): Promise<unknown>;
  ledger: Pick<CertificateLedger, 'chainId' | 'contract' | 'status'>;
  ledgerStatusSchema?: string;
  isIssuerRevoked?: (issuer: string) => Promise<boolean>;
  isCertificateSuspended?: (issuer: string, credentialId: string) => Promise<boolean>;
  validateSchemas?: (
    credential: CredentialDocument,
    references: CredentialReference[],
  ) => Promise<unknown>;
  legacy?: {
    includes(digest: string): boolean;
    verifyStatus(entries: CredentialStatusEntry[], issuer: string, now?: Date): Promise<unknown>;
  };
}

/** Challenge bindings used to verify a holder presentation. */
export interface PresentationConstraints {
  audience: string;
  nonce: string;
  state?: string;
  credentialTypes?: string[];
  expectedCount?: number;
  now?: Date;
}

/** Existing holder-presentation verifier with holder identity removed from retained evidence. */
export type VerifyPresentation = (
  token: string,
  options: PresentationConstraints,
) => Promise<Omit<VerifiedCredential, 'subject'>[]>;
