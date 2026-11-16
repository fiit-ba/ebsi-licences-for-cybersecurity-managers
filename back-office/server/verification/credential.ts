import { compactVerify, decodeJwt, decodeProtectedHeader, importJWK } from 'jose';
import { certificateStatusKey, credentialHash, secretDigest } from '../issuance/protection.ts';
import type { CredentialVerifierOptions, CredentialPayload, VerifyCredential } from './types.ts';

/** Credential verification failure that cannot establish an accepted credential. */
export class CredentialVerificationError extends Error {
  readonly code: string;

  /**
   * Create a verification failure.
   *
   * @param code - Stable verification failure code.
   */
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// A terminal credential decision may be recorded only after verifying that
// the credential was signed for the holder who submitted the presentation.
/** Terminal refusal for a signature-verified credential bound to the presenting holder. */
export class BoundCredentialRefusal extends CredentialVerificationError {
  readonly outcome: string;

  /**
   * Create a holder-bound terminal refusal.
   *
   * @param code - Stable failure code.
   * @param outcome - Public result category such as REVOKED or SUSPENDED.
   */
  constructor(code: string, outcome: string) {
    super(code);
    this.outcome = outcome;
  }
}

/**
 * Require a credential invariant before verification can continue.
 *
 * @param condition - Condition that must hold.
 * @param code - Stable verification failure code.
 * @returns No return value.
 * @throws CredentialVerificationError when the invariant fails.
 */
function requireCredential(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CredentialVerificationError(code);
}

/**
 * Split a bounded compact credential and its canonical disclosure suffix.
 *
 * @param value - Untrusted serialized credential.
 * @returns The signed JWT and at most 128 disclosure strings.
 * @throws CredentialVerificationError for invalid credential/disclosure syntax or size.
 */
function splitCredential(value: unknown) {
  requireCredential(typeof value === 'string' && value.length <= 128 * 1024, 'InvalidCredential');
  const [jwt, ...parts] = value.split('~');
  if (parts.length)
    requireCredential(parts.pop() === '' && parts.every(Boolean), 'InvalidDisclosure');
  requireCredential(parts.length <= 128, 'InvalidDisclosure');
  return { jwt, disclosures: parts };
}

/**
 * Verify disclosure digests and reconstruct nonduplicated subject claims.
 *
 * @param subject - Signed credential subject.
 * @param algorithm - Declared selective-disclosure digest algorithm.
 * @param disclosures - Encoded disclosures presented by the holder.
 * @returns Public and correctly disclosed claims without the holder ID.
 * @throws CredentialVerificationError for unsupported algorithms, duplicate/reserved keys or
 * invalid disclosures.
 */
function revealed(subject: Record<string, unknown>, algorithm: unknown, disclosures: string[]) {
  const claims = new Map(Object.entries(subject));
  const hashes = claims.get('_sd');
  claims.delete('_sd');
  claims.delete('id');
  const validDigest = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  requireCredential(
    !claims.has('_sd_alg') &&
      !claims.has('...') &&
      (hashes === undefined
        ? !disclosures.length
        : algorithm === 'sha-256' &&
          Array.isArray(hashes) &&
          hashes.length <= 128 &&
          hashes.every(validDigest) &&
          new Set(hashes).size === hashes.length),
    'InvalidDisclosure',
  );
  const available = new Set(Array.isArray(hashes) ? hashes : []);
  for (const disclosure of disclosures) {
    requireCredential(/^[A-Za-z0-9_-]+$/.test(disclosure), 'InvalidDisclosure');
    const bytes = Buffer.from(disclosure, 'base64url');
    requireCredential(
      bytes.toString('base64url') === disclosure &&
        available.delete(secretDigest(disclosure).toString('base64url')),
      'InvalidDisclosure',
    );
    let item;
    try {
      item = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new CredentialVerificationError('InvalidDisclosure');
    }
    requireCredential(
      Array.isArray(item) &&
        item.length === 3 &&
        typeof item[0] === 'string' &&
        item[0].length > 0 &&
        typeof item[1] === 'string' &&
        item[1].length > 0 &&
        !['id', '_sd', '_sd_alg', '...'].includes(item[1]) &&
        !claims.has(item[1]),
      'InvalidDisclosure',
    );
    claims.set(item[1], item[2]);
  }
  return Object.fromEntries(claims);
}

/**
 * Create verification against trusted issuer, schema, status and local protection adapters.
 *
 * @param options - Assertion-key and trust resolvers, ledger and optional
 * schema/legacy/local-overlay adapters.
 * @returns A verifier accepting a credential plus holder/type/clock constraints.
 */
export function credentialVerifier(options: CredentialVerifierOptions): VerifyCredential {
  const {
    assertionKey,
    checkAccreditation,
    ledger,
    ledgerStatusSchema = undefined,
    isIssuerRevoked = undefined,
    isCertificateSuspended = undefined,
    validateSchemas = undefined,
    legacy = undefined,
  } = options;

  /**
   * Verify credential signature, holder binding, disclosures, trust, validity and status.
   *
   * @param value - Untrusted serialized credential and disclosures.
   * @param options - Optional expected holder DID, accepted types and verification clock.
   * @returns Verified credential identity, issuer, holder, type, disclosed claims and status key.
   * @throws CredentialVerificationError for malformed/untrusted data; BoundCredentialRefusal for
   * holder-bound terminal decisions; external adapter errors.
   */
  async function verifyCredential(
    value: string,
    options: { expectedHolder?: string; credentialTypes?: string[]; now?: Date } = {},
  ) {
    const { expectedHolder, credentialTypes, now = new Date() } = options;

    const { jwt, disclosures } = splitCredential(value);
    let payload;
    let kid;
    try {
      payload = decodeJwt<CredentialPayload>(jwt);
      ({ kid } = decodeProtectedHeader(jwt));
    } catch {
      throw new CredentialVerificationError('InvalidCredential');
    }
    const issuer = payload.iss;
    requireCredential(
      typeof issuer === 'string' &&
        /^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/.test(issuer) &&
        typeof kid === 'string' &&
        kid.startsWith(issuer + '#'),
      'InvalidIssuer',
    );
    const issuedAt = payload.vc?.issuanceDate ?? payload.vc?.issued;
    const issuedTime = typeof issuedAt === 'string' ? Date.parse(issuedAt) : NaN;
    requireCredential(
      Number.isFinite(issuedTime) && issuedTime >= 0 && issuedTime <= +now + 5_000,
      'InvalidIssuanceDate',
    );
    const jwk = await assertionKey(issuer, kid, new Date(issuedTime));
    try {
      await compactVerify(jwt, await importJWK(jwk, 'ES256'), { algorithms: ['ES256'] });
    } catch {
      throw new CredentialVerificationError('InvalidSignature');
    }

    const vc = payload.vc;
    const subject = vc?.credentialSubject;
    const statuses = Array.isArray(vc?.credentialStatus)
      ? vc.credentialStatus
      : [vc?.credentialStatus];
    const isLegacy = Boolean(
      legacy &&
      !statuses.some((entry) => entry?.type === 'PlrLedgerStatusEntry') &&
      legacy.includes(secretDigest(jwt).toString('hex')),
    );
    const number =
      subject?.certificateNumber ?? (isLegacy ? subject?.registrationNumber : undefined);
    requireCredential(
      vc?.issuer === issuer &&
        typeof vc.id === 'string' &&
        Boolean(vc.id) &&
        (vc.id === payload.jti || (isLegacy && payload.jti === undefined)) &&
        typeof subject?.id === 'string' &&
        (subject.id === payload.sub || (isLegacy && payload.sub === undefined)) &&
        (expectedHolder === undefined || expectedHolder === subject.id) &&
        typeof number === 'string' &&
        number.length > 0,
      'InvalidCredentialBinding',
    );

    const generic = ['VerifiableCredential', 'VerifiableAttestation'];
    const types = Array.isArray(vc.type) ? vc.type.filter((type) => !generic.includes(type)) : [];
    requireCredential(
      types.length === 1 &&
        typeof types[0] === 'string' &&
        vc.type.includes(generic[0]) &&
        (isLegacy ||
          (vc.type.length === 3 && vc.type[0] === generic[0] && vc.type[1] === generic[1])),
      'InvalidCredentialType',
    );
    const type = types[0];
    requireCredential(
      !credentialTypes?.length || credentialTypes.includes(type),
      'UnexpectedCredentialType',
    );

    const from = Date.parse(vc.validFrom ?? vc.issuanceDate);
    const until = Date.parse(vc.expirationDate ?? vc.validUntil);
    const nbf = (payload.nbf ?? (isLegacy ? Math.floor(from / 1000) : undefined)) as number;
    const exp = (payload.exp ?? (isLegacy ? Math.floor(until / 1000) : undefined)) as number;
    requireCredential(
      Number.isSafeInteger(nbf) &&
        Number.isSafeInteger(exp) &&
        exp > nbf &&
        Math.floor(from / 1000) === nbf &&
        Math.floor(until / 1000) === exp &&
        (isLegacy || (from === nbf * 1000 && until === exp * 1000)),
      'InvalidValidity',
    );

    let statusKey = null;
    if (!isLegacy) {
      // The record's key is computed from the issuer and the credential's id (V4); the entry
      // names only the certificate registry.
      statusKey = '0x' + certificateStatusKey(issuer, vc.id).toString('hex');
      const status = statuses[0];
      const contract = ledger.contract.toLowerCase();
      requireCredential(
        Array.isArray(vc.credentialStatus) &&
          statuses.length === 1 &&
          status?.type === 'PlrLedgerStatusEntry' &&
          status.chainId === ledger.chainId &&
          status.contract?.toLowerCase?.() === contract &&
          status.statusKey === undefined &&
          status.id === `eip155:${ledger.chainId}:${contract}`,
        'InvalidLedgerReference',
      );
    }

    const schemas =
      isLegacy && !Array.isArray(vc.credentialSchema) ? [vc.credentialSchema] : vc.credentialSchema;
    requireCredential(
      Array.isArray(schemas) &&
        (isLegacy
          ? schemas.length >= 1 && schemas.length <= 4
          : schemas.length === 2 && schemas[1]?.id === ledgerStatusSchema) &&
        schemas.every(
          (schema) =>
            schema?.type === 'FullJsonSchemaValidator2021' && typeof schema.id === 'string',
        ),
      'InvalidSchemaReference',
    );
    const terms = Array.isArray(vc.termsOfUse) ? vc.termsOfUse : [vc.termsOfUse];
    const accreditation = terms.find((term) => term?.type === 'IssuanceCertificate')?.id;
    requireCredential(typeof accreditation === 'string', 'InvalidAccreditationReference');
    const claims = revealed(subject, payload._sd_alg, disclosures);
    if (isIssuerRevoked && (await isIssuerRevoked(issuer))) {
      throw new BoundCredentialRefusal('AccreditationRevoked', 'REVOKED');
    }
    if (isCertificateSuspended && (await isCertificateSuspended(issuer, vc.id))) {
      throw new BoundCredentialRefusal('Suspended', 'SUSPENDED');
    }
    if (exp * 1000 <= +now) throw new BoundCredentialRefusal('Expired', 'EXPIRED');
    if (nbf * 1000 > +now) throw new BoundCredentialRefusal('NotYetValid', 'NOT_YET_VALID');
    try {
      await checkAccreditation(issuer, type, { reference: accreditation, schemaId: schemas[0].id });
    } catch (error) {
      if ((error as { body?: { reason?: string } }).body?.reason === 'NotAccredited') {
        throw new BoundCredentialRefusal('NotAccredited', 'UNTRUSTED_ISSUER');
      }
      throw error;
    }

    if (validateSchemas) {
      await validateSchemas({ ...vc, credentialSubject: { id: subject.id, ...claims } }, schemas);
    }
    if (isLegacy) {
      await legacy!.verifyStatus(statuses, issuer, now);
    } else {
      const record = await ledger.status(statusKey!);
      requireCredential(
        record?.standing !== 0n &&
          record.issuerDid === issuer &&
          String(record.credentialHash).toLowerCase() ===
            '0x' + credentialHash(jwt).toString('hex') &&
          record.validFrom === BigInt(nbf) &&
          record.validUntil === BigInt(exp),
        'LedgerRecordMismatch',
      );
      if (record.standing === 2n) throw new BoundCredentialRefusal('Suspended', 'SUSPENDED');
      if (record.standing === 3n) throw new BoundCredentialRefusal('Revoked', 'REVOKED');
      requireCredential(record.standing === 1n, 'LedgerRecordMismatch');
    }

    return { credentialId: vc.id, issuer, subject: subject.id, type, claims, statusKey };
  }
  return verifyCredential;
}
