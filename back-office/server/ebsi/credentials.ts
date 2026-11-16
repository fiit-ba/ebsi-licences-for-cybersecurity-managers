import { randomUUID } from 'node:crypto';
import { signJwt, type JwsSigner } from '../keys/kms-jws.ts';

/** What an accreditation lets its subject issue or accredit: a schema and the types under it. */
export interface AccreditationScope {
  schemaId: string;
  types: string[];
}

/** The EBSI Verifiable Attestation types the trust chain is made of. */
export type TrustChainCredentialType =
  | 'VerifiableAuthorisationToOnboard'
  | 'VerifiableAccreditationToAccredit'
  | 'VerifiableAccreditationToAttest';

const fiveYears = 5 * 365 * 24 * 3600;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Issue one EBSI Verifiable Attestation of the trust chain, signed with the accreditor's
 * credential key (its DID's assertionMethod).
 *
 * @param options - Signer, issuer and subject DIDs, credential type, and for an accreditation
 * the attribute it is stored under, what it covers, the accreditor's own attribute
 * (`termsOfUse`) and its schema and end.
 * @returns The credential JWT.
 * @throws Signer errors.
 * @remarks The same shape the development Support Office uses for a RootTAO, so one verifier
 * walks the whole chain: each link names its parent's TIR attribute in `termsOfUse`.
 */
export async function trustChainCredential(options: {
  signer: JwsSigner;
  issuer: string;
  subject: string;
  type: TrustChainCredentialType;
  attributeId?: string;
  accreditedFor?: AccreditationScope[];
  termsOfUse?: string;
  schema: string;
  validUntil?: Date;
}) {
  const now = Math.floor(Date.now() / 1000);
  const until = options.validUntil ? Math.floor(+options.validUntil / 1000) : now + fiveYears;
  const id = `urn:uuid:${randomUUID()}`;
  const accreditedFor = options.accreditedFor?.map((scope) => ({
    schemaId: scope.schemaId,
    types: scope.types,
    limitJurisdiction: 'https://publications.europa.eu/resource/authority/atu/SVK',
  }));
  const vc = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id,
    type: ['VerifiableCredential', 'VerifiableAttestation', options.type],
    issuer: options.issuer,
    issuanceDate: iso(now),
    issued: iso(now),
    validFrom: iso(now),
    expirationDate: iso(until),
    credentialSubject: {
      id: options.subject,
      ...(options.attributeId ? { reservedAttributeId: options.attributeId } : {}),
      ...(accreditedFor ? { accreditedFor } : {}),
    },
    ...(options.termsOfUse
      ? { termsOfUse: { id: options.termsOfUse, type: 'IssuanceCertificate' } }
      : {}),
    credentialSchema: { id: options.schema, type: 'FullJsonSchemaValidator2021' },
  };
  return signJwt(options.signer, {
    iss: options.issuer,
    sub: options.subject,
    jti: id,
    iat: now,
    nbf: now,
    exp: until,
    vc,
  });
}

/**
 * Read what a stored accreditation covers, to tell whether it must be reissued.
 *
 * @param credential - Accreditation JWT as the TIR holds it.
 * @returns Its schema/type scopes in a stable order, or undefined for an unreadable credential.
 */
export function accreditationCoverage(credential: string) {
  try {
    const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString('utf8'));
    const scopes = payload?.vc?.credentialSubject?.accreditedFor;
    if (!Array.isArray(scopes)) return undefined;
    return JSON.stringify(
      scopes
        .map((scope: AccreditationScope) => ({
          schemaId: scope.schemaId,
          types: [...scope.types].sort(),
        }))
        .sort((x: AccreditationScope, y: AccreditationScope) =>
          x.schemaId.localeCompare(y.schemaId),
        ),
    );
  } catch {
    return undefined;
  }
}

/**
 * Stable text of a requested coverage, comparable with accreditationCoverage.
 * @param scopes - Requested scopes.
 * @returns The same normalized text.
 */
export function coverageText(scopes: AccreditationScope[]) {
  return JSON.stringify(
    scopes
      .map((scope) => ({ schemaId: scope.schemaId, types: [...scope.types].sort() }))
      .sort((x, y) => x.schemaId.localeCompare(y.schemaId)),
  );
}
