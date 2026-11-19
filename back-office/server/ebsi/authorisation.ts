import { randomUUID } from 'node:crypto';
import { signJwt, type JwsSigner } from '../keys/kms-jws.ts';
import { ebsiApi, type EbsiApiVersion } from './api.ts';

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
  /**
   * Another key of the holder's DID, for a presentation the first cannot sign: on the pilot, the
   * Trusted Issuers Registry and the Timestamp API take ES256 presentations only, so the
   * holder's P-256 authentication key signs those.
   */
  alternate?: JwsSigner;
  /** The credential the scope asks for; omitted for scopes satisfied by a self-attestation. */
  credential?: string;
}

const tokenLifetimeMargin = 120_000;

/**
 * Create an EBSI Authorisation client: on the pilot, Authorisation API v4 (a presentation for the
 * scope's presentation definition); in Core API v1, OpenID4VP 1.0 with DCQL.
 *
 * @param options - EBSI's API origin (for example `https://api-pilot.ebsi.eu`), the API shape
 * (`core-v1` unless given) and transport.
 * @returns Self-attestation and cached access-token operations.
 * @throws Error for a base URL with credentials, a query or a fragment.
 * @remarks Tokens are cached in process memory per holder and scope until two minutes before
 * they expire; `did-registry:invite` tokens are bound to one key and never cached.
 */
export function ebsiAuthorisation(options: {
  baseUrl: string;
  version?: EbsiApiVersion;
  fetchApi?: typeof fetch;
}) {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash)
    throw new Error('Configure a plain EBSI Core API base URL.');
  const root = base.href.replace(/\/+$/, '');
  const api = ebsiApi(root, options.version ?? 'core-v1');
  const auth = api.authorisation;
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
   * The presentation definition of a pilot scope (Authorisation API v4).
   * @param scope - The scope, in the pilot's name.
   * @returns Its id, its input descriptor (if it asks for a credential) and the VP algorithms.
   * @throws EbsiAuthorisationError for an unavailable API or an unknown scope.
   */
  async function presentationDefinition(scope: string) {
    let response: Response;
    try {
      response = await request(
        `${auth}/presentation-definitions?scope=${encodeURIComponent(`openid ${scope}`)}`,
        { redirect: 'error', signal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw new EbsiAuthorisationError('unavailable', 'EBSI Authorisation API is unavailable.');
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok || typeof body?.id !== 'string' || !Array.isArray(body.input_descriptors))
      throw new EbsiAuthorisationError(
        body?.error ?? 'unavailable',
        body?.error_description ??
          body?.detail ??
          `EBSI answered HTTP ${response.status} for ${scope}.`,
      );
    const algorithms = (body.format?.jwt_vp?.alg ?? ['ES256']) as string[];
    return {
      id: body.id as string,
      descriptor: body.input_descriptors[0]?.id as string | undefined,
      algorithms,
    };
  }

  /**
   * Obtain a pilot access token (Authorisation API v4): a VP JWT with the scope's credential,
   * if it asks for one, and its presentation submission.
   * @param input - Scope, holder, keys and the credential the scope asks for.
   * @returns The bearer token.
   * @throws EbsiAuthorisationError for refusals, outages, or no key the scope accepts.
   */
  async function pilotToken(input: TokenRequest) {
    const scope = api.scope(input.scope);
    const definition = await presentationDefinition(scope);
    const signer = [input.signer, input.alternate].find(
      (candidate) => candidate && definition.algorithms.includes(candidate.alg),
    );
    if (!signer)
      throw new EbsiAuthorisationError(
        'invalid_request',
        `${scope} takes a presentation signed with ${definition.algorithms.join(' or ')}.`,
      );
    if (definition.descriptor && !input.credential)
      throw new EbsiAuthorisationError('invalid_request', `${scope} needs a credential.`);
    const credentials = definition.descriptor ? [input.credential!] : [];
    const now = Math.floor(Date.now() / 1000);
    const id = `urn:uuid:${randomUUID()}`;
    const presentation = await signJwt(
      signer,
      {
        iss: input.holder,
        sub: input.holder,
        aud: auth,
        jti: id,
        nonce: randomUUID(),
        iat: now,
        nbf: now,
        // The API takes a presentation that expires within five minutes.
        exp: now + 120,
        vp: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          id,
          type: ['VerifiablePresentation'],
          holder: input.holder,
          verifiableCredential: credentials,
        },
      },
      // Registering a DID: it is not resolvable yet, so its key travels with the presentation.
      input.scope === 'did-registry:invite' ? { jwk: signer.publicJwk } : {},
    );
    const submission = {
      id: randomUUID(),
      definition_id: definition.id,
      descriptor_map: definition.descriptor
        ? [
            {
              id: definition.descriptor,
              format: 'jwt_vp',
              path: '$',
              path_nested: {
                id: definition.descriptor,
                format: 'jwt_vc',
                path: '$.vp.verifiableCredential[0]',
              },
            },
          ]
        : [],
    };
    let response: Response;
    try {
      response = await request(`${auth}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'vp_token',
          scope: `openid ${scope}`,
          vp_token: presentation,
          presentation_submission: JSON.stringify(submission),
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
        body?.error_description ?? body?.detail ?? `EBSI answered HTTP ${response.status}.`,
      );
    return { token: body.access_token as string, expires: Number(body.expires_in) };
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
    if (api.version === 'pilot') {
      const { token: issued, expires } = await pilotToken(input);
      if (!invite && Number.isFinite(expires) && expires * 1000 > tokenLifetimeMargin)
        cache.set(key, { token: issued, until: Date.now() + expires * 1000 - tokenLifetimeMargin });
      return issued;
    }
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
