import { randomUUID } from 'node:crypto';
import { signJwt, type JwsSigner } from '../keys/kms-jws.ts';

/** Refusal or outage of EBSI's Authorisation API, without credential or token content. */
export class EbsiAuthorisationError extends Error {
  readonly code: string;

  /**
   * Describe why no access token was granted.
   * @param code - OAuth error code, or `unavailable` for transport failures.
   * @param message - Public explanation from the API or the transport.
   */
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** A Core API v1 scope a back-office write needs (hub.ebsi.eu/api/access-control). */
export type EbsiScope =
  | 'did-registry:invite'
  | 'did-registry:write'
  | 'issuers-registry:invite'
  | 'issuers-registry:write'
  | 'timestamp:write'
  | 'ledger:invoke';

/** What a holder presents for one access token. */
export interface TokenRequest {
  scope: EbsiScope;
  /** The DID the token is for: its holder and the presentation's issuer. */
  holder: string;
  /** The holder's key: its capabilityInvocation key, or for `did-registry:invite` the key it registers with. */
  signer: JwsSigner;
  /** The credential the scope asks for; omitted for scopes satisfied by a self-attestation. */
  credential?: string;
}

const tokenLifetimeMargin = 120_000;

/**
 * Create an EBSI Core API v1 Authorisation client (OpenID4VP 1.0 with DCQL).
 *
 * @param options - Core API base URL (for example `https://api-pilot.ebsi.eu`) and transport.
 * @returns DCQL lookup, self-attestation and cached access-token operations.
 * @throws Error for a base URL with credentials, a query or a fragment.
 * @remarks Tokens are cached in process memory per holder and scope until two minutes before
 * they expire; `did-registry:invite` tokens are bound to one key and never cached.
 */
export function ebsiAuthorisation(options: { baseUrl: string; fetchApi?: typeof fetch }) {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash)
    throw new Error('Configure a plain EBSI Core API base URL.');
  const root = base.href.replace(/\/+$/, '');
  const auth = `${root}/v1/auth`;
  const request = options.fetchApi ?? fetch;
  const cache = new Map<string, { token: string; until: number }>();

  /**
   * Read the credential query a scope asks for.
   * @param scope - Requested scope.
   * @returns The DCQL credential-query id and its accepted types.
   * @throws EbsiAuthorisationError for an unknown scope or an unavailable API.
   */
  async function dcql(scope: EbsiScope) {
    let response: Response;
    try {
      response = await request(
        `${auth}/dcql-queries?scope=${encodeURIComponent(`openid ${scope}`)}`,
        { redirect: 'error', signal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw new EbsiAuthorisationError('unavailable', 'EBSI Authorisation API is unavailable.');
    }
    const body = await response.json().catch(() => undefined);
    const query = body?.dcql_query?.credentials?.[0];
    if (!response.ok || typeof query?.id !== 'string')
      throw new EbsiAuthorisationError(
        body?.error ?? 'unavailable',
        body?.error_description ?? `EBSI answered HTTP ${response.status} for ${scope}.`,
      );
    return { id: query.id as string, types: (query.meta?.type_values ?? []) as string[][] };
  }

  /**
   * Issue a SelfAttestation credential, as scopes without another credential require.
   * @param holder - The DID attesting itself.
   * @param signer - Its capabilityInvocation key.
   * @returns The credential JWT.
   * @throws Signer errors.
   */
  async function selfAttestation(holder: string, signer: JwsSigner) {
    const now = Math.floor(Date.now() / 1000);
    const iso = new Date(now * 1000).toISOString();
    const id = `urn:uuid:${randomUUID()}`;
    return signJwt(signer, {
      iss: holder,
      sub: holder,
      jti: id,
      iat: now,
      nbf: now,
      exp: now + 300,
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id,
        type: ['VerifiableCredential', 'VerifiableAttestation', 'SelfAttestation'],
        issuer: holder,
        issuanceDate: iso,
        issued: iso,
        validFrom: iso,
        credentialSubject: { id: holder },
        credentialSchema: {
          id: `${root}/v1/schemas-registry/schemas/zSelfAttestation`,
          type: 'FullJsonSchemaValidator2021',
        },
      },
    });
  }

  /**
   * Obtain an access token: present the scope's credential in an OpenID4VP 1.0 VP and exchange it.
   * @param input - Scope, holder, holder key and the credential the scope asks for.
   * @returns The bearer token.
   * @throws EbsiAuthorisationError for refusals and outages; signer errors.
   */
  async function token(input: TokenRequest) {
    const invite = input.scope === 'did-registry:invite';
    const key = `${input.holder} ${input.scope}`;
    const cached = cache.get(key);
    if (!invite && cached && cached.until > Date.now()) return cached.token;
    const query = await dcql(input.scope);
    const credential =
      input.credential ??
      (query.types.some((set) => set.includes('SelfAttestation'))
        ? await selfAttestation(input.holder, input.signer)
        : undefined);
    if (!credential)
      throw new EbsiAuthorisationError(
        'invalid_request',
        `${input.scope} needs a ${query.types.flat().join(' or ')} credential.`,
      );
    const now = Math.floor(Date.now() / 1000);
    const presentation = await signJwt(
      input.signer,
      {
        iss: input.holder,
        sub: input.holder,
        aud: auth,
        nonce: randomUUID(),
        iat: now,
        exp: now + 120,
        vp: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiablePresentation'],
          holder: input.holder,
          verifiableCredential: [credential],
        },
      },
      // Registering a DID: it is not resolvable yet, so its key travels with the presentation.
      invite ? { jwk: input.signer.publicJwk } : {},
    );
    let response: Response;
    try {
      response = await request(`${auth}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'vp_token',
          scope: `openid ${input.scope}`,
          vp_token: JSON.stringify({ [query.id]: [presentation] }),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new EbsiAuthorisationError('unavailable', 'EBSI Authorisation API is unavailable.');
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok || typeof body?.access_token !== 'string')
      throw new EbsiAuthorisationError(
        body?.error ?? 'unavailable',
        body?.error_description ?? `EBSI answered HTTP ${response.status}.`,
      );
    const expires = Number(body.expires_in);
    if (!invite && Number.isFinite(expires) && expires * 1000 > tokenLifetimeMargin)
      cache.set(key, {
        token: body.access_token,
        until: Date.now() + expires * 1000 - tokenLifetimeMargin,
      });
    return body.access_token as string;
  }

  return {
    token,
    selfAttestation,
    /**
     * Drop a cached token the Ledger API refused, so the next call obtains a fresh one.
     * @param holder - Token holder.
     * @param scope - Token scope.
     * @returns No return value.
     */
    forget(holder: string, scope: EbsiScope) {
      cache.delete(`${holder} ${scope}`);
    },
  };
}

/** EBSI Authorisation API client, as composed for one installation. */
export type EbsiAuthorisation = ReturnType<typeof ebsiAuthorisation>;
