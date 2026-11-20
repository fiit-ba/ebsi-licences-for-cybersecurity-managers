import { randomBytes } from 'node:crypto';
import { secretDigest } from './protection.ts';
import type { FinalizerOptions, FinalizationInput } from './types.ts';
import { ebsiSchemaIds } from '../schemas/ebsi-schemas.ts';

/** Years a licence is valid unless its issuer says otherwise (NBÚ certification scheme, 5.1). */
const defaultYears = 3;
const reserved = new Set(['id', 'licenceNumber', '_metadata', '_sd', '_sd_alg', '...']);
const schemaType = 'FullJsonSchemaValidator2021';
const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
const iso = (timestamp: number) => new Date(timestamp * 1000).toISOString();
/**
 * The same instant the given number of calendar years later.
 * @param timestamp - Seconds since the epoch.
 * @param years - Whole years to add.
 * @returns Seconds since the epoch; 29 February moves to 1 March in a common year.
 */
const yearsLater = (timestamp: number, years: number) => {
  const date = new Date(timestamp * 1000);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return epoch(date);
};

/**
 * Create a selective-disclosure credential signer with ledger references.
 *
 * @param options - Signing, ledger, protection, schema/accreditation adapters and optional test clock.
 * @returns An async finalizer accepting certificate, claims, holder subject and optional
 * transaction client; it returns the signed credential with disclosures.
 * @throws Error if the governance ledger configuration is invalid.
 * @remarks Finalization rejects expired validity, invalid signatures or signing identifiers and
 * propagates trust, schema and signing errors. The separate background worker records
 * the certificate on the ledger after collection commits.
 */
export function certificateFinalizer(options: FinalizerOptions) {
  const {
    signingKey,
    ledger,
    schemaAddress,
    ledgerStatusSchema,
    accreditationAddress,
    ensureAccredited = undefined,
    now = () => new Date(),
  } = options;

  const chainId = ledger.chainId;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('A configured certificate registry is required.');
  }

  /**
   * Sign a holder-bound credential for collection and subsequent ledger delivery.
   *
   * @param input - Certificate row, normalized claims, holder DID and optional transaction
   * connection.
   * @returns The compact credential with selective disclosures, if present.
   * @throws Error for expired validity, invalid key or signature; trust, signing, encryption and
   * schema errors.
   * @remarks A retry generates fresh selective disclosures; the record key follows from the
   * credential's id.
   */
  async function finalizeCertificate(input: FinalizationInput) {
    const { certificate, claims, subject, client = undefined } = input;
    const issuer = certificate.issuer_did;
    // The certificate registry of the TI's TAO keeps the record.
    const contract = (await ledger.contractFor(issuer)).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(contract))
      throw new Error('The TI has no certificate registry to record its certificates in.');
    const number = certificate.licence_number;
    const id = certificate.credential_id;
    const schemaId = schemaAddress(certificate.tsr_id);
    if (ensureAccredited) {
      await ensureAccredited(issuer, certificate.credential_type, {
        attribute: certificate.tir_attribute_id,
        schemaId,
      });
    }
    const issuedAt = now();
    // Validity is in whole seconds, as the JWT's nbf and exp are.
    const validFrom = certificate.valid_from ? epoch(certificate.valid_from) : epoch(issuedAt);
    const start = iso(validFrom);
    const validUntil = certificate.valid_until
      ? epoch(certificate.valid_until)
      : yearsLater(epoch(issuedAt), defaultYears);
    if (validUntil <= validFrom || validUntil <= epoch(now())) {
      throw new Error('Certificate validity ended before finalization.');
    }

    const disclosures = Object.entries(claims)
      .filter(([key]) => !reserved.has(key))
      .map(([key, value]) =>
        Buffer.from(JSON.stringify([randomBytes(16).toString('base64url'), key, value])).toString(
          'base64url',
        ),
      );
    const subjectClaims = {
      id: subject,
      licenceNumber: number,
      ...(disclosures.length
        ? { _sd: disclosures.map((value) => secretDigest(value).toString('base64url')).sort() }
        : {}),
    };

    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id,
      issuer,
      type: ['VerifiableCredential', 'VerifiableAttestation', certificate.credential_type],
      // EBSI's rules for a credential: `issued` is the signing instant (the JWT's iat), and
      // `issuanceDate` is the same as `validFrom` (the JWT's nbf). `issued` keeps the
      // milliseconds a verifier needs to find the issuer's key at that instant.
      issued: issuedAt.toISOString(),
      issuanceDate: start,
      validFrom: start,
      expirationDate: iso(validUntil),
      credentialSubject: subjectClaims,
      credentialSchema: [
        { type: schemaType, id: schemaId },
        { type: schemaType, id: ledgerStatusSchema },
        // Its termsOfUse is an IssuanceCertificate: EBSI's type extension for it.
        { type: schemaType, id: schemaAddress(ebsiSchemaIds.issuanceCertificate) },
      ],
      termsOfUse: [
        {
          type: 'IssuanceCertificate',
          id: accreditationAddress(issuer, certificate.tir_attribute_id),
        },
      ],
      // The certificate registry keeps the record. Its key is computed from the issuer and
      // this credential's id by whoever checks it, so the credential does not carry it.
      credentialStatus: [
        {
          id: `eip155:${chainId}:${contract}`,
          type: 'PlrLedgerStatusEntry',
          chainId,
          contract,
        },
      ],
    };

    const { sign, kid } = await signingKey(issuer, certificate.issuer_id, client);
    if (
      typeof kid !== 'string' ||
      !kid.startsWith(issuer + '#') ||
      kid.length === issuer.length + 1
    ) {
      throw new Error('The signing key does not identify a verification method of the issuer.');
    }
    // Issuance is the signing instant, not the earlier offer registration.
    // A key published after registration must be resolvable at issuance.
    if (!Number.isFinite(+issuedAt) || validUntil <= epoch(issuedAt))
      throw new Error('Certificate validity ended before signing.');
    // Validate the exact timestamp and full subject that the signature covers,
    // before replacing private attributes with selective-disclosure digests.
    await options.validateCredential?.(
      {
        ...vc,
        credentialSubject: {
          ...Object.fromEntries(Object.entries(claims).filter(([key]) => !reserved.has(key))),
          id: subject,
          licenceNumber: number,
        },
      },
      vc.credentialSchema,
    );
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'ES256', typ: 'JWT', kid });
    const payload = encode({
      iss: issuer,
      sub: subject,
      jti: id,
      iat: epoch(issuedAt),
      nbf: validFrom,
      exp: validUntil,
      vc,
      ...(disclosures.length ? { _sd_alg: 'sha-256' } : {}),
    });
    const signingInput = Buffer.from(`${header}.${payload}`, 'ascii');
    const signature = Buffer.from(await sign(signingInput));
    if (signature.length !== 64) throw new Error('The issuer returned an invalid ES256 signature.');
    const jwt = signingInput.toString('ascii') + '.' + signature.toString('base64url');

    // Collection commits before the background ledger worker
    // registers this tuple. A provider outage must not withhold a signed VC.
    return disclosures.length ? [jwt, ...disclosures, ''].join('~') : jwt;
  }
  return finalizeCertificate;
}
