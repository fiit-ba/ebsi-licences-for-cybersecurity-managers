import { didRegistry, DidResolutionError } from '../ebsi/did-registry.ts';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { IssuanceError } from './claims.ts';
import type { CredentialPayload } from '../verification/types.ts';

const attestation = 'VerifiableAccreditationToAttest';
const accreditation = 'VerifiableAccreditationToAccredit';
const trustChain = 'VerifiableAuthorisationForTrustChain';
const didPattern = /^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/;
const attributePattern = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Validate and normalize a configured registry base URL.
 *
 * @param value - HTTP(S) registry URL without credentials, query or fragment.
 * @returns The normalized base without trailing slashes.
 * @throws Error or TypeError for invalid registry URLs.
 */
function registryBase(value: string) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Expected a configured HTTP(S) registry URL.');
  }
  return url.href.replace(/\/+$/, '');
}

/**
 * Reject an accreditation condition that cannot establish trust.
 *
 * @param condition - Condition that must hold.
 * @param message - Public refusal explanation.
 * @returns No return value.
 * @throws IssuanceError with NotAccredited when the condition is false.
 */
function requireTrust(condition: unknown, message: string): asserts condition {
  if (!condition) throw new IssuanceError(409, 'NotAccredited', message);
}

/**
 * Parse an optional accreditation validity bound.
 *
 * @param value - Date string or missing value.
 * @param fallback - Bound used when absent.
 * @returns Epoch milliseconds, the fallback for absence, or NaN for invalid input.
 */
function time(value: unknown, fallback: number) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return NaN;
  return Date.parse(value);
}

/**
 * Create EBSI DID and accreditation-chain validation adapters.
 *
 * @param options - TIR/DID registry URLs, trusted-root DIDs and optional fetch implementation.
 * @returns Assertion-key resolution, accreditation-address generation and issuer trust checks.
 * @throws Error if registry URLs or trusted roots are invalid.
 */
export function ebsiIssuerTrust(options: {
  tirUrl: string;
  didRegistryUrl: string;
  didRegistryContract?: string;
  trustedRoots: Iterable<string>;
  fetchRegistry?: typeof fetch;
}) {
  const {
    tirUrl,
    didRegistryUrl,
    didRegistryContract = undefined,
    trustedRoots,
    fetchRegistry = fetch,
  } = options;

  const tir = registryBase(tirUrl);
  const dids = didRegistry({
    identifiersUrl: didRegistryUrl,
    contractAddress: didRegistryContract,
    fetchRegistry,
  });
  const roots = new Set<string>(trustedRoots);
  if (!roots.size || [...roots].some((did) => !didPattern.test(did)))
    throw new Error('Configure trusted EBSI roots.');

  /**
   * Build an attribute URL only for an accepted issuer and attribute identifier.
   *
   * @param did - Issuer DID.
   * @param attribute - TIR attribute identifier.
   * @returns An address beneath the configured TIR.
   * @throws IssuanceError for an invalid DID or attribute.
   */
  function accreditationAddress(did: string, attribute: unknown) {
    requireTrust(
      typeof did === 'string' &&
        didPattern.test(did) &&
        typeof attribute === 'string' &&
        attributePattern.test(attribute),
      'Invalid issuer accreditation reference.',
    );
    return `${tir}/issuers/${did}/attributes/${attribute}`;
  }

  /**
   * Fetch registry JSON with redirects disabled and a bounded timeout.
   *
   * @param url - Trusted registry resource URL.
   * @returns Parsed JSON, or null for HTTP 404.
   * @throws IssuanceError with AccreditationUnavailable for transport, HTTP or JSON failure.
   */
  async function registryJson(url: string) {
    try {
      const response = await fetchRegistry(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error('Registry HTTP error');
      }
      return await response.json();
    } catch {
      throw new IssuanceError(
        503,
        'AccreditationUnavailable',
        'EBSI could not confirm accreditation.',
      );
    }
  }

  /**
   * Resolve a public P-256 key authorized by the issuer DID document.
   *
   * @param did - Expected controlling DID.
   * @param kid - Exact assertion verification-method identifier.
   * @param at - Optional issuance instant for historical DID resolution.
   * @returns The authorized public JWK.
   * @throws IssuanceError for invalid or unavailable DID documents, relationships or keys.
   */
  async function assertionKey(did: string, kid: string, at?: Date) {
    try {
      return await dids.key(did, kid, 'assertionMethod', at, 'P-256');
    } catch (error) {
      if (error instanceof DidResolutionError && error.unavailable) {
        throw new IssuanceError(
          503,
          'AccreditationUnavailable',
          'EBSI could not confirm the issuer key.',
        );
      }
      throw new IssuanceError(
        409,
        'NotAccredited',
        'The issuer did not authorize this assertion key.',
      );
    }
  }

  /**
   * Verify an accreditation JWT and its subject and validity bindings.
   *
   * @param token - Accreditation JWT from the trusted registry.
   * @param subject - DID being accredited.
   * @param now - Current time in milliseconds.
   * @returns Verified credential content and signer DID.
   * @throws IssuanceError for invalid signatures, bindings, validity or registry availability.
   */
  async function signedAccreditation(token: string, subject: string, now: number) {
    requireTrust(
      typeof token === 'string' && token.length <= 64 * 1024,
      'Missing accreditation credential.',
    );
    let signer;
    let kid;
    try {
      signer = decodeJwt(token).iss;
      ({ kid } = decodeProtectedHeader(token));
    } catch {
      requireTrust(false, 'Invalid accreditation credential.');
    }
    const unsigned = decodeJwt(token).vc as
      { issuanceDate?: unknown; issued?: unknown } | undefined;
    const issuedAt = unsigned?.issuanceDate ?? unsigned?.issued;
    requireTrust(
      issuedAt === undefined || typeof issuedAt === 'string',
      'Invalid accreditation issuance timestamp.',
    );
    const at = typeof issuedAt === 'string' ? new Date(issuedAt) : undefined;
    requireTrust(
      !at || (Number.isFinite(+at) && +at >= 0 && +at <= now + 5_000),
      'Invalid accreditation issuance timestamp.',
    );
    const jwk = await assertionKey(signer!, kid!, at);
    let payload: CredentialPayload;
    try {
      ({ payload } = await jwtVerify<CredentialPayload>(token, await importJWK(jwk, 'ES256'), {
        algorithms: ['ES256'],
        issuer: signer,
        currentDate: new Date(now),
      }));
    } catch {
      requireTrust(false, 'The accreditation signature or validity is invalid.');
    }
    const vc = payload.vc;
    requireTrust(
      vc?.issuer === signer &&
        vc.credentialSubject?.id === subject &&
        (payload.sub === undefined || payload.sub === subject) &&
        Array.isArray(vc.type) &&
        time(vc.validFrom ?? vc.issuanceDate, -Infinity) <= now &&
        time(vc.validUntil ?? vc.expirationDate, Infinity) > now,
      'The accreditation does not identify this issuer or is outside its validity.',
    );
    return { vc, signer };
  }

  /**
   * Walk signed accreditation links to a configured trust anchor.
   *
   * @param did - Issuer DID.
   * @param type - Credential type being issued.
   * @param options - Initial TIR attribute and exact schema URL.
   * @returns Completion when every chain link authorizes the requested schema/type.
   * @throws IssuanceError for missing, revoked, cyclic, overdeep, out-of-scope or unavailable trust
   * records.
   */
  async function ensureAccredited(
    did: string,
    type: string,
    options: { attribute?: string; schemaId?: string },
  ) {
    const { attribute, schemaId } = options;

    const requiredTypes = ['VerifiableCredential', 'VerifiableAttestation', type];
    const now = Date.now();
    let subject = did;
    let url = accreditationAddress(did, attribute);
    const visited = new Set();

    for (let depth = 0; depth < 8; depth++) {
      requireTrust(!visited.has(subject), 'The accreditation chain contains a cycle.');
      visited.add(subject);
      const record = await registryJson(url);
      requireTrust(
        record?.did === subject &&
          record.attribute &&
          String(record.attribute.issuerType).toLowerCase() !== 'revoked',
        'The accreditation is missing or revoked.',
      );
      const { vc, signer } = await signedAccreditation(record.attribute.body, subject, now);
      const isRoot = depth > 0 && vc.type.includes(trustChain);
      if (isRoot) {
        requireTrust(
          roots.has(signer!) && signer !== subject,
          'The chain does not end at a configured trust anchor.',
        );
        return;
      }
      const expected = depth === 0 ? attestation : accreditation;
      requireTrust(vc.type.includes(expected), 'The accreditation has the wrong role.');
      const scope = vc.credentialSubject.accreditedFor;
      requireTrust(
        Array.isArray(scope) &&
          scope.some(
            (entry) =>
              entry?.schemaId === schemaId &&
              Array.isArray(entry.types) &&
              requiredTypes.every((value) => entry.types.includes(value)),
          ),
        'The accreditation does not cover this schema version and credential type.',
      );

      const terms = Array.isArray(vc.termsOfUse) ? vc.termsOfUse : [vc.termsOfUse];
      const prefix = `${tir}/issuers/${signer}/attributes/`;
      const linked = terms.find(
        (term) => typeof term?.id === 'string' && term.id.startsWith(prefix),
      );
      requireTrust(
        linked && attributePattern.test(linked.id.slice(prefix.length)),
        'The accreditation does not identify its parent in the configured TIR.',
      );
      subject = signer!;
      url = linked.id;
    }
    requireTrust(false, 'The accreditation chain exceeded the maximum depth.');
  }

  /**
   * Validate a credential's accreditation reference and its full trust chain.
   *
   * @param did - Credential issuer DID.
   * @param type - Credential type.
   * @param options - Credential accreditation URL and exact schema URL.
   * @returns Completion when the reference and chain are trusted.
   * @throws IssuanceError for a mismatched reference or failed accreditation check.
   */
  async function checkAccreditation(
    did: string,
    type: string,
    options: { reference: string; schemaId: string },
  ) {
    const { reference, schemaId } = options;

    const prefix = accreditationAddress(did, 'attribute').slice(0, -'attribute'.length);
    requireTrust(
      typeof reference === 'string' && reference.startsWith(prefix),
      'The credential references a different issuer or TIR.',
    );
    const attribute = reference.slice(prefix.length);
    await ensureAccredited(did, type, { attribute, schemaId });
  }

  return { ensureAccredited, checkAccreditation, accreditationAddress, assertionKey };
}
