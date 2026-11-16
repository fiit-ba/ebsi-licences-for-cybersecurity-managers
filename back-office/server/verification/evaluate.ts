import { validateVerificationSchema } from './schema-validation.ts';
import { revealDisclosures } from './disclosures.ts';
import { verificationRegistry, VerificationRegistryError, underRegistry } from './registry.ts';
import {
  emptyOutcome,
  evidenceTime,
  unverified,
  validityWindow,
  verificationTime,
  VerificationStop,
} from './outcomes.ts';
import type { CredentialOutcome } from './outcomes.ts';
import type { CertificateLedger } from '../issuance/types.ts';
import { certificateStatusKey, credentialHash } from '../issuance/protection.ts';

/** Existing dependencies of the credential evaluator, with no signing authority. */
export interface EvaluationOptions {
  registry: ReturnType<typeof verificationRegistry>;
  ledger?: Pick<CertificateLedger, 'contract' | 'status'>;
  certificationBody?: (
    vc: Record<string, any>,
    issuer: string,
    now: Date,
  ) => Promise<Record<string, any> | null>;
}

/**
 * Create evidence-producing verification that distinguishes refusals from provider outages.
 * @param options - Read-only registries, ledger and local certification-body observation.
 * @returns Credential evaluation with one fresh recheck of key/trust/status refusals.
 */
export function credentialEvaluator(options: EvaluationOptions) {
  const { registry, ledger, certificationBody } = options;

  /**
   * Evaluate a credential once in signature, schema, trust and standing check order without retaining the payload.
   * @param token - Presented JWT-VC and its optional disclosures.
   * @param constraints - Holder, presentation result, clock and cache-bypass context.
   * @returns Structured decision, including partial evidence when a condition fails.
   */
  async function evaluate(
    token: string,
    constraints: { holder?: string; presentationVerified?: boolean; now?: Date; fresh?: boolean },
  ): Promise<CredentialOutcome> {
    const { holder, presentationVerified, now = new Date(), fresh = false } = constraints;
    const outcome = emptyOutcome(now, presentationVerified !== undefined);
    const checks = outcome.checks;
    try {
      if (presentationVerified === false)
        throw new VerificationStop(
          'INDETERMINATE',
          'The presentation did not pass verification',
          'presentation_valid',
        );
      checks.presentation_valid = presentationVerified ? true : null;
      if (typeof token !== 'string' || Buffer.byteLength(token) > 256 * 1024)
        throw new VerificationStop('INVALID_SIGNATURE', 'Not a compact JWS', 'signature_valid');
      const signedToken = token.trim().split('~')[0];
      if (token.includes('~') && token.trim().split('~').at(-1))
        throw new VerificationStop(
          'INVALID_SIGNATURE',
          'A key-binding JWT is not expected after the disclosures',
          'disclosures_valid',
        );
      const unsigned = unverified(signedToken);
      const unsignedVc = unsigned.payload.vc ?? {};
      outcome.types = Array.isArray(unsignedVc.type) ? unsignedVc.type : [];
      outcome.key_id = typeof unsigned.header.kid === 'string' ? unsigned.header.kid : null;
      const at =
        verificationTime(unsignedVc.issuanceDate || unsignedVc.validFrom || unsignedVc.issued) ??
        verificationTime(unsigned.payload.iat);
      outcome.resolved_at = at === null ? null : evidenceTime(at);
      const signed = await registry.signed(signedToken, fresh);
      outcome.issuer = signed.issuer;
      checks.signature_valid = checks.issuer_key_valid = true;

      const payload = revealDisclosures(token, signed.payload);
      const vc = payload.vc;
      checks.disclosures_valid = true;
      const { start, end } = validityWindow(vc, payload);
      outcome.valid_from = start === null ? null : evidenceTime(start);
      outcome.valid_until = end === null ? null : evidenceTime(end);
      if (start !== null && start > +now + 60_000)
        throw new VerificationStop(
          'NOT_YET_VALID',
          `Valid from ${evidenceTime(start)}`,
          'time_valid',
        );
      if (end !== null && end <= +now)
        throw new VerificationStop('EXPIRED', `Expired at ${evidenceTime(end)}`, 'time_valid');
      checks.time_valid = true;
      if (holder !== undefined) {
        if (vc.credentialSubject?.id !== holder)
          throw new VerificationStop(
            'INDETERMINATE',
            'The credential was issued to someone other than the presenter',
            'holder_bound',
          );
        checks.holder_bound = true;
      }
      outcome.attributes = Object.fromEntries(
        Object.entries(vc.credentialSubject ?? {}).filter(([name]) => name !== 'id'),
      );

      const schemas = Array.isArray(vc.credentialSchema)
        ? vc.credentialSchema
        : vc.credentialSchema
          ? [vc.credentialSchema]
          : [];
      try {
        await registry.trust(
          signed.issuer,
          schemas[0]?.id ?? '',
          outcome.types,
          +now,
          outcome.trust_chain,
          fresh,
        );
      } catch (error) {
        if (error instanceof VerificationRegistryError)
          throw new VerificationStop('INDETERMINATE', error.message, 'issuer_accredited');
        throw error;
      }
      if (certificationBody) {
        const body = await certificationBody(vc, signed.issuer, now);
        outcome.certification_body = body;
        if (body?.revoked_at)
          throw new VerificationStop(
            'REVOKED',
            `The accreditation of the certification body ${body.revoked_organization} was revoked on ${body.revoked_at}`,
            'issuer_accredited',
          );
        if (body?.accredited_at_issuance === false)
          throw new VerificationStop(
            'UNTRUSTED_ISSUER',
            `The certification body ${body.name} was not accredited when it issued the certificate`,
            'issuer_accredited',
          );
      }
      checks.issuer_accredited = true;

      if (!schemas.length)
        throw new VerificationStop(
          'INDETERMINATE',
          'The credential names no schema',
          'schemas_valid',
        );
      for (const schema of schemas) {
        if (schema?.type !== 'FullJsonSchemaValidator2021')
          throw new VerificationStop(
            'INDETERMINATE',
            `Unsupported schema validator ${schema?.type}`,
            'schemas_valid',
          );
        if (!underRegistry(schema.id, registry.tsr))
          throw new VerificationStop(
            'INDETERMINATE',
            `${schema.id} is not in the Trusted Schemas Registry`,
            'schemas_valid',
          );
        let document;
        try {
          document = await registry.schema(schema.id, fresh);
        } catch {
          throw new VerificationStop(
            'INDETERMINATE',
            `Schema ${schema.id} could not be loaded`,
            'schemas_valid',
          );
        }
        validateVerificationSchema(vc, document, schema.id);
        outcome.schemas.push(schema.id);
      }
      checks.schemas_valid = true;

      const statuses = Array.isArray(vc.credentialStatus)
        ? vc.credentialStatus
        : [vc.credentialStatus];
      // The entry names the certificate registry; the record's key is computed here from the
      // issuer and the credential's id, never taken from the credential.
      const status = statuses.find(
        (entry: any) =>
          entry?.type === 'PlrLedgerStatusEntry' &&
          /^0x[0-9a-fA-F]{40}$/.test(String(entry.contract)),
      );
      if (!status || typeof vc.id !== 'string' || !vc.id)
        throw new VerificationStop(
          'INDETERMINATE',
          'The credential names no record on the certificate registry',
          'status_available',
        );
      if (!ledger)
        throw new VerificationStop(
          'STATUS_UNAVAILABLE',
          'No certificate registry is configured here',
          'status_available',
        );
      if (status.contract.toLowerCase() !== ledger.contract.toLowerCase())
        throw new VerificationStop(
          'STATUS_UNAVAILABLE',
          'The credential names a certificate registry other than this one',
          'status_available',
        );
      const statusKey = '0x' + certificateStatusKey(signed.issuer, vc.id).toString('hex');
      let record;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        record = await Promise.race([
          ledger.status(statusKey),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Ledger timeout')), 30_000).unref();
          }),
        ]);
      } catch {
        throw new VerificationStop(
          'STATUS_UNAVAILABLE',
          'The certificate registry could not be read',
          'status_available',
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
      const standing =
        ({ 1: 'valid', 2: 'suspended', 3: 'revoked' } as Record<string, string>)[
          String(record?.standing)
        ] ?? 'none';
      outcome.ledger = {
        contract: ledger.contract.toLowerCase(),
        standing,
        certificate_number: String(vc.credentialSubject?.certificateNumber || '') || null,
        registered_at: record?.registeredAt
          ? evidenceTime(Number(record.registeredAt) * 1000)
          : null,
        changed_at: record?.changedAt ? evidenceTime(Number(record.changedAt) * 1000) : null,
      };
      if (standing === 'none')
        throw new VerificationStop(
          'STATUS_UNAVAILABLE',
          'The certificate registry has no record of the certificate yet',
          'status_available',
        );
      checks.status_available = true;
      // The record must be this credential's: its TI, the hash of the very JWT presented, and
      // its dates. A stolen signing key cannot put other content under a real record's key.
      const stated = {
        issuer: signed.issuer,
        credentialHash: '0x' + credentialHash(signedToken).toString('hex'),
        validFrom: Math.trunc((start ?? 0) / 1000),
        validUntil: Math.trunc((end ?? 0) / 1000),
      };
      const recorded = {
        issuer: record.issuerDid,
        credentialHash: String(record.credentialHash).toLowerCase(),
        validFrom: Number(record.validFrom),
        validUntil: Number(record.validUntil),
      };
      const differs = (Object.keys(stated) as (keyof typeof stated)[]).filter(
        (name) => stated[name] !== recorded[name],
      );
      if (differs.length)
        throw new VerificationStop(
          'INDETERMINATE',
          `The certificate does not match its record on the certificate registry (${differs.join(', ')})`,
          'record_matches',
        );
      checks.record_matches = true;
      if (standing !== 'valid') {
        outcome.statusPurpose = standing === 'revoked' ? 'revocation' : 'suspension';
        throw new VerificationStop(
          standing === 'revoked' ? 'REVOKED' : 'SUSPENDED',
          `The certificate registry records the certificate as ${standing}`,
          'standing_valid',
        );
      }
      checks.standing_valid = true;
      if (outcome.scope === 'credential')
        outcome.reason =
          'The credential is valid. Nothing here establishes who presents it; a relying party needs the presentation flow for that.';
    } catch (error) {
      if (error instanceof VerificationStop) {
        outcome.state = error.state;
        outcome.reason = error.message;
        outcome.checks[error.check] = false;
      } else {
        outcome.state = 'INDETERMINATE';
        outcome.reason = 'Verification could not be completed';
      }
    }
    return outcome;
  }
  /**
   * Recheck cache-sensitive refusals once after key or trust changes.
   * @param token - Presented credential.
   * @param constraints - Optional holder, envelope, clock and explicit fresh-read context.
   * @returns Credential outcome; invalid data and outages remain verdicts.
   */
  async function verifyCredential(
    token: string,
    constraints: {
      holder?: string;
      presentationVerified?: boolean;
      now?: Date;
      fresh?: boolean;
    } = {},
  ) {
    const outcome = await evaluate(token, constraints);
    return !constraints.fresh &&
      ['UNTRUSTED_ISSUER', 'INVALID_SIGNATURE', 'STATUS_UNAVAILABLE'].includes(outcome.state)
      ? evaluate(token, { ...constraints, fresh: true })
      : outcome;
  }
  return verifyCredential;
}
