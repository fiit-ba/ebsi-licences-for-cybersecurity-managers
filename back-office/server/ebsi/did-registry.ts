import { createPublicKey } from 'node:crypto';

/** Public EC key accepted for EBSI signatures; private JWK members are excluded. */
export interface PublicEcKey {
  kty: 'EC';
  crv: 'P-256' | 'secp256k1';
  x: string;
  y: string;
}

/** DID verification relationship required by a key's declared purpose. */
export type DidRelationship = 'assertionMethod' | 'authentication' | 'capabilityInvocation';

/** DID resolution refusal, distinguished from temporary registry unavailability. */
export class DidResolutionError extends Error {
  readonly unavailable: boolean;

  /**
   * Create a DID resolution error without leaking a response body.
   * @param message - Public explanation.
   * @param unavailable - Whether the registry could not be read reliably.
   */
  constructor(message: string, unavailable = false) {
    super(message);
    this.unavailable = unavailable;
  }
}

/**
 * Validate a public EC JWK and discard optional non-key metadata.
 * @param value - Untrusted JSON key.
 * @param curve - Optional curve required by the caller.
 * @returns A canonical public JWK suitable for thumbprinting and signature verification.
 * @throws DidResolutionError for private, malformed, unsupported or invalid-point keys.
 */
export function publicEcKey(value: unknown, curve?: PublicEcKey['crv']): PublicEcKey {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DidResolutionError('Invalid public EC key.');
  const key = value as Record<string, unknown>;
  const coordinate = (part: unknown): part is string =>
    typeof part === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(part) &&
    Buffer.from(part, 'base64url').toString('base64url') === part;
  if (
    key.kty !== 'EC' ||
    !['P-256', 'secp256k1'].includes(String(key.crv)) ||
    (curve && key.crv !== curve) ||
    Object.hasOwn(key, 'd') ||
    !coordinate(key.x) ||
    !coordinate(key.y)
  ) {
    throw new DidResolutionError('Invalid public EC key.');
  }
  const result: PublicEcKey = { kty: 'EC', crv: key.crv as PublicEcKey['crv'], x: key.x, y: key.y };
  try {
    createPublicKey({ key: { ...result }, format: 'jwk' });
  } catch {
    throw new DidResolutionError('Invalid public EC point.');
  }
  return result;
}

/**
 * Read a bounded JSON object from a registry response.
 * @param response - Successful response whose body is consumed and released.
 * @returns The parsed JSON object.
 * @throws DidResolutionError for absent, oversized or malformed JSON content; stream errors.
 */
async function documentBody(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new DidResolutionError('The DID registry returned no document.', true);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) {
        await reader.cancel();
        throw new DidResolutionError('The DID document is too large.', true);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new DidResolutionError('Invalid DID registry JSON.', true);
  }
}

/**
 * Create bounded DID resolution against one explicitly configured identifiers endpoint.
 * @param options - Identifiers URL, optional contract instance and fetch implementation.
 * @returns Current/historical document resolution and relationship-specific public-key lookup.
 * @throws Error for an invalid registry base or contract address.
 * @remarks Supports pilot v5 and Core v1 URL layouts without changing API profiles implicitly.
 */
export function didRegistry(options: {
  identifiersUrl: string;
  contractAddress?: string;
  fetchRegistry?: typeof fetch;
}) {
  const { identifiersUrl, contractAddress, fetchRegistry = fetch } = options;
  const base = new URL(identifiersUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (contractAddress !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(contractAddress))
  )
    throw new Error('Configure a plain DID identifiers URL and optional contract address.');

  /**
   * Resolve a DID now or at an explicit issuance timestamp, with no current-document fallback.
   * @param did - Legal-entity EBSI DID.
   * @param at - Optional historical instant on or after the Unix epoch.
   * @returns The exact DID document returned for that version.
   * @throws DidResolutionError for unknown DIDs, invalid timestamps, inconsistent documents or failed registry reads.
   */
  async function document(did: string, at?: Date): Promise<Record<string, unknown>> {
    if (
      !/^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/.test(did) ||
      (at && (!Number.isFinite(+at) || +at < 0))
    ) {
      throw new DidResolutionError('Invalid DID or historical timestamp.');
    }
    const url = new URL(base.href.replace(/\/+$/, '') + '/' + did);
    if (at) url.searchParams.set('valid-at', at.toISOString());
    if (contractAddress) url.searchParams.set('contractAddress', contractAddress);
    let value: Record<string, unknown>;
    try {
      const response = await fetchRegistry(url.href, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
        headers: { accept: 'application/did+json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DidResolutionError(
          response.status === 404
            ? 'The DID version is unavailable.'
            : 'The DID registry is unavailable.',
          response.status !== 404,
        );
      }
      value = await documentBody(response);
    } catch (error) {
      if (error instanceof DidResolutionError) throw error;
      throw new DidResolutionError('The DID registry could not be read.', true);
    }
    if (value.id !== did)
      throw new DidResolutionError('The DID document identifies a different issuer.');
    return value;
  }

  /**
   * Resolve one unambiguous method authorized for the requested relationship and time.
   * @param did - Expected controlling EBSI DID.
   * @param kid - Exact DID verification-method ID.
   * @param relationship - Required DID relationship.
   * @param at - Optional historical issuance instant.
   * @param curve - Optional required EC curve.
   * @returns The validated public key of that authorized method.
   * @throws DidResolutionError for missing/ambiguous methods, wrong controller/relationship/key or failed reads.
   */
  async function key(
    did: string,
    kid: string,
    relationship: DidRelationship,
    at?: Date,
    curve?: PublicEcKey['crv'],
  ): Promise<PublicEcKey> {
    if (typeof kid !== 'string' || !kid.startsWith(did + '#') || kid.length === did.length + 1)
      throw new DidResolutionError('Invalid DID verification-method reference.');
    const value = await document(did, at);
    const relationships = value[relationship];
    const methods = value.verificationMethod;
    if (
      !Array.isArray(relationships) ||
      !relationships.some((entry) => entry === kid || entry?.id === kid)
    )
      throw new DidResolutionError(
        'The DID document does not authorize this verification relationship.',
      );
    const candidates = [
      ...(Array.isArray(methods) ? methods : []),
      ...relationships.filter((entry) => typeof entry === 'object' && entry !== null),
    ].filter((entry) => entry?.id === kid);
    // An inline method repeated in verificationMethod is allowed only if identical.
    const distinct = [
      ...new Map(candidates.map((entry) => [JSON.stringify(entry), entry])).values(),
    ];
    if (
      distinct.length !== 1 ||
      distinct[0].controller !== did ||
      distinct[0].type !== 'JsonWebKey2020'
    )
      throw new DidResolutionError('The DID verification method is missing, ambiguous or invalid.');
    return publicEcKey(distinct[0].publicKeyJwk, curve);
  }
  return { document, key };
}
