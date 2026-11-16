import { createPublicKey, verify } from 'node:crypto';
import {
  unverified,
  validityWindow,
  verificationTime,
  evidenceTime,
  VerificationStop,
} from './outcomes.ts';
import type { CredentialOutcome } from './outcomes.ts';

/** Registry transport refusal; a missing record is distinguished from an outage. */
export class VerificationRegistryError extends Error {
  readonly missing: boolean;
  /**
   * Describe a trusted-registry read failure.
   * @param message - Public explanation without provider response content.
   * @param missing - Whether the registry explicitly answered 404.
   */
  constructor(message: string, missing = false) {
    super(message);
    this.missing = missing;
  }
}

/** Configured registry endpoints, anchors and cache durations. */
export interface VerificationRegistryOptions {
  didr: string;
  tir: string;
  tsr: string;
  roots: string[];
  fetchRegistry?: typeof fetch;
  didSeconds?: number;
  trustSeconds?: number;
  schemaSeconds?: number;
}

/**
 * Constrain all credential-controlled references to a configured registry.
 * @param value - Untrusted absolute reference.
 * @param base - Configured registry base.
 * @returns Whether its origin and resource path remain beneath that registry.
 */
export function underRegistry(value: unknown, base: string) {
  try {
    if (typeof value !== 'string') return false;
    const url = new URL(value);
    const root = new URL(base.replace(/\/+$/, '') + '/');
    return (
      url.origin === root.origin &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.startsWith(root.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Create protocol-compatible cached DID, signed TIR-chain and TSR access.
 * @param options - Explicit trusted registries, roots, transport and cache settings.
 * @returns Bounded reads, historical JWS validation and evidence-producing trust traversal.
 * @throws Error for invalid configured registry URLs or cache durations.
 */
export function verificationRegistry(options: VerificationRegistryOptions) {
  const {
    fetchRegistry = fetch,
    didSeconds = 300,
    trustSeconds = 3600,
    schemaSeconds = 86400,
  } = options;
  const [didr, tir, tsr] = [options.didr, options.tir, options.tsr].map((value) => {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Configure plain verification registry URLs.');
    return url.href.replace(/\/+$/, '');
  });
  if (
    [didSeconds, trustSeconds, schemaSeconds].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error('Registry cache durations must be nonnegative whole seconds.');
  const cache = new Map<string, { until: number; value: any }>();

  /**
   * Read bounded registry JSON without following redirects or caching failures.
   * @param url - Resource beneath one of the explicitly trusted registries.
   * @param seconds - Successful-response cache lifetime.
   * @param fresh - Whether to bypass the cache for a refusal recheck.
   * @returns Parsed JSON resource.
   * @throws VerificationRegistryError for missing, failed, oversized or malformed responses.
   */
  async function read(url: string, seconds: number, fresh = false): Promise<any> {
    if (![didr, tir, tsr].some((base) => underRegistry(url, base)))
      throw new VerificationRegistryError('The registry reference points elsewhere');
    const hit = cache.get(url);
    if (!fresh && hit && hit.until > Date.now()) return structuredClone(hit.value);
    try {
      const response = await fetchRegistry(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new VerificationRegistryError(
          `EBSI answered HTTP ${response.status} for ${url}`,
          response.status === 404,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 256 * 1024) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (seconds) {
        // Bound memory without making a positive trust assertion about evicted entries.
        if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
        cache.set(url, { until: Date.now() + seconds * 1000, value: structuredClone(value) });
      }
      return value;
    } catch (error) {
      if (error instanceof VerificationRegistryError) throw error;
      throw new VerificationRegistryError(`EBSI read failed for ${url}`);
    }
  }

  /**
   * Verify an issuer JWS using its assertion key at credential issuance.
   * @param token - Compact issuer-signed credential or accreditation.
   * @param fresh - Whether to bypass cached DID resolution.
   * @returns Signed VC, payload, issuer and header.
   * @throws VerificationStop for signature/key refusal or unavailable historical DID.
   */
  async function signed(token: string, fresh = false) {
    const { header, payload } = unverified(token);
    const vc = payload.vc;
    if (!vc || typeof vc !== 'object' || Array.isArray(vc))
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        'The JWT carries no vc claim',
        'signature_valid',
      );
    const issuer = typeof vc.issuer === 'object' ? vc.issuer?.id : vc.issuer;
    if (typeof issuer !== 'string' || !issuer.startsWith('did:'))
      throw new VerificationStop(
        'UNTRUSTED_ISSUER',
        'The credential names no issuer DID',
        'issuer_key_valid',
      );
    if (payload.iss && payload.iss !== issuer)
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        "iss does not match the credential's issuer",
        'signature_valid',
      );
    const at =
      verificationTime(vc.issuanceDate || vc.validFrom || vc.issued) ??
      verificationTime(payload.iat);
    const url = new URL(didr + '/' + encodeURIComponent(issuer).replaceAll('%3A', ':'));
    // Historical key admission must retain the signed issuance instant. Truncating
    // it to seconds can place a just-onboarded credential before its key activation.
    if (at !== null)
      url.searchParams.set('valid-at', new Date(at).toISOString().replace('.000Z', 'Z'));
    let document;
    try {
      document = await read(url.href, didSeconds, fresh);
    } catch (error) {
      if (error instanceof VerificationRegistryError)
        throw new VerificationStop(
          error.missing ? 'UNTRUSTED_ISSUER' : 'INDETERMINATE',
          error.missing ? `${issuer} is not in the DID Registry` : error.message,
          'issuer_key_valid',
        );
      throw error;
    }
    const kid = header.kid;
    if (!kid)
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        'The signature names no key',
        'issuer_key_valid',
      );
    if (typeof kid !== 'string' || (kid.includes('#') && !kid.startsWith(issuer + '#')))
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        'Signed with a key of another DID',
        'issuer_key_valid',
      );
    const wanted = new Set([kid, issuer + '#' + kid]);
    const method = (document.verificationMethod ?? []).find((item: any) => wanted.has(item?.id));
    if (
      !method ||
      !(document.assertionMethod ?? []).some(
        (item: any) => (typeof item === 'string' ? item : item?.id) === method.id,
      )
    )
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        `${kid} is not an assertion key of ${issuer}`,
        'issuer_key_valid',
      );
    const jwk = method.publicKeyJwk;
    const curve = ({ ES256: 'P-256', ES256K: 'secp256k1' } as Record<string, string>)[header.alg];
    if (!curve || jwk?.kty !== 'EC' || jwk.crv !== curve)
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        `Unsupported or mismatched algorithm ${header.alg}`,
        'signature_valid',
      );
    // Security deviation: private key material and a different DID/controller are refused.
    if (document.id !== issuer || method.controller !== issuer || jwk.d)
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        'The DID assertion method identifies another controller',
        'issuer_key_valid',
      );
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      const [head, body, signature] = token.split('.');
      if (
        !verify(
          'sha256',
          Buffer.from(head + '.' + body),
          { key, dsaEncoding: 'ieee-p1363' },
          Buffer.from(signature, 'base64url'),
        )
      )
        throw new Error();
    } catch {
      throw new VerificationStop(
        'INVALID_SIGNATURE',
        'The signature does not verify',
        'signature_valid',
      );
    }
    return { header, payload, vc, issuer: issuer as string };
  }

  /**
   * Resolve a TIR attribute under the configured trust boundary.
   * @param url - Absolute attribute URL.
   * @param fresh - Whether to bypass cached trust data.
   * @returns Signed accreditation attribute with its subject DID.
   * @throws VerificationStop for explicit missing/untrusted records; VerificationRegistryError on outage.
   */
  async function attribute(url: string, fresh: boolean) {
    if (!underRegistry(url, tir))
      throw new VerificationStop(
        'UNTRUSTED_ISSUER',
        'An accreditation points outside the Trusted Issuers Registry',
        'issuer_accredited',
      );
    let record;
    try {
      record = await read(url, trustSeconds, fresh);
    } catch (error) {
      if (error instanceof VerificationRegistryError && error.missing)
        throw new VerificationStop(
          'UNTRUSTED_ISSUER',
          'An accreditation in the chain no longer exists',
          'issuer_accredited',
        );
      throw error;
    }
    if (!record.attribute?.body)
      throw new VerificationStop(
        'UNTRUSTED_ISSUER',
        'A TIR attribute carries no accreditation',
        'issuer_accredited',
      );
    return { did: record.did, ...record.attribute };
  }

  /**
   * Read the issuer's accreditation candidates from its TIR collection.
   * @param did - Subject DID.
   * @param fresh - Whether to bypass cached trust data.
   * @returns Ordered accreditation candidates.
   * @throws VerificationStop on explicit distrust; VerificationRegistryError on outage.
   */
  async function attributes(did: string, fresh: boolean): Promise<any[]> {
    let record;
    try {
      record = await read(
        tir + '/issuers/' + encodeURIComponent(did).replaceAll('%3A', ':'),
        trustSeconds,
        fresh,
      );
    } catch (error) {
      if (error instanceof VerificationRegistryError && error.missing)
        throw new VerificationStop(
          'UNTRUSTED_ISSUER',
          `${did} is not a trusted issuer`,
          'issuer_accredited',
        );
      throw error;
    }
    if (typeof record.attributes !== 'string')
      throw new VerificationStop(
        'INDETERMINATE',
        'The TIR answered in a shape this verifier does not accept',
        'issuer_accredited',
      );
    if (!underRegistry(record.attributes, tir))
      throw new VerificationStop(
        'UNTRUSTED_ISSUER',
        'The TIR attribute link points elsewhere',
        'issuer_accredited',
      );
    const listing = await read(record.attributes, trustSeconds, fresh);
    return Promise.all(
      (listing.items ?? [])
        .filter((item: any) => item?.href)
        .map((item: any) => attribute(item.href, fresh)),
    );
  }

  /**
   * Walk TI/TAO/RootTAO accreditations and retain the public chain evidence.
   * @param issuer - Credential issuer DID.
   * @param schema - First credential schema reference.
   * @param types - All signed credential types.
   * @param now - Verification time in milliseconds.
   * @param record - Evidence array populated as each trusted link is established.
   * @param fresh - Whether to bypass cached reads.
   * @returns Completion after a configured root is reached.
   * @throws VerificationStop for explicit distrust; VerificationRegistryError on registry outage.
   */
  async function trust(
    issuer: string,
    schema: string,
    types: string[],
    now: number,
    record: CredentialOutcome['trust_chain'],
    fresh = false,
  ) {
    let subject = issuer;
    let expected = 'VerifiableAccreditationToAttest';
    let candidates = await attributes(subject, fresh);
    const visited = new Set<string>();
    for (let depth = 0; depth < 5; depth++) {
      if (visited.has(subject)) break;
      visited.add(subject);
      if (candidates.some((item) => String(item.issuerType ?? '').toLowerCase() === 'revoked'))
        throw new VerificationStop(
          'UNTRUSTED_ISSUER',
          `The accreditation of ${subject} was revoked`,
          'issuer_accredited',
        );
      let chosen: Awaited<ReturnType<typeof signed>> | undefined;
      for (const candidate of candidates) {
        try {
          const result = await signed(candidate.body, fresh);
          const { start, end } = validityWindow(result.vc);
          if (
            !result.vc.type?.includes(expected) ||
            result.vc.credentialSubject?.id !== subject ||
            (start !== null && start > now + 60_000) ||
            (end !== null && end <= now)
          )
            continue;
          if (
            expected !== 'VerifiableAuthorisationForTrustChain' &&
            !(result.vc.credentialSubject?.accreditedFor ?? []).some(
              (scope: any) =>
                scope.schemaId === schema && types.every((type) => scope.types?.includes(type)),
            )
          )
            continue;
          chosen = result;
          break;
        } catch (error) {
          if (!(error instanceof VerificationStop)) throw error;
          if (error.state === 'INDETERMINATE')
            throw new VerificationStop(
              'INDETERMINATE',
              `Accreditation of ${subject}: ${error.message}`,
              'issuer_accredited',
            );
        }
      }
      if (!chosen)
        throw new VerificationStop(
          'UNTRUSTED_ISSUER',
          `${subject} holds no ${expected} covering ${schema} for ${types.join(', ')}`,
          'issuer_accredited',
        );
      const roles: Record<string, string> = {
        VerifiableAccreditationToAttest: 'TI',
        VerifiableAccreditationToAccredit: 'TAO',
        VerifiableAuthorisationForTrustChain: 'RootTAO',
      };
      record.push({ did: subject, role: roles[expected], accredited_by: chosen.issuer });
      if (expected === 'VerifiableAuthorisationForTrustChain') {
        if (!options.roots.includes(chosen.issuer))
          throw new VerificationStop(
            'UNTRUSTED_ISSUER',
            `The chain ends at ${chosen.issuer}, which is not a trusted root`,
            'issuer_accredited',
          );
        record.push({ did: chosen.issuer, role: 'root', accredited_by: null });
        return;
      }
      const terms = Array.isArray(chosen.vc.termsOfUse)
        ? chosen.vc.termsOfUse[0]
        : chosen.vc.termsOfUse;
      candidates = terms?.id
        ? [await attribute(terms.id, fresh)]
        : await attributes(chosen.issuer, fresh);
      const parentTypes = candidates.flatMap((item) => {
        try {
          return unverified(item.body).payload.vc?.type ?? [];
        } catch {
          return [];
        }
      });
      subject = chosen.issuer;
      expected = parentTypes.includes('VerifiableAuthorisationForTrustChain')
        ? 'VerifiableAuthorisationForTrustChain'
        : 'VerifiableAccreditationToAccredit';
    }
    throw new VerificationStop(
      'UNTRUSTED_ISSUER',
      'The accreditation chain does not end at a trusted root',
      'issuer_accredited',
    );
  }
  return {
    signed,
    trust,
    schema: (url: string, fresh = false) => read(url, schemaSeconds, fresh),
    tsr,
  };
}
