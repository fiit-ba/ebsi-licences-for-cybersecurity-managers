import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { postgresPresentationSessions } from './sessions.ts';
import { parseVpToken } from './dcql.ts';

const defaultScope = 'plr-verify-cybersecurity-manager';
const defaultType = 'CybersecurityManagerCertificate';

/**
 * Create the compatible wallet request and direct-post presentation profile.
 *
 * @param origin - Public verifier origin.
 * @param sessions - Presentation session store.
 * @param type - Requested credential type.
 * @returns Ephemeral request-signing JWKS and offer/request/submission/result operations.
 * @throws Key-generation or JWK export errors.
 */
export async function walletPresentationProfile(
  origin: string,
  sessions: ReturnType<typeof postgresPresentationSessions>,
  type = defaultType,
) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = crypto.randomUUID();
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

  /**
   * The DCQL query of one session: one credential of the type, nothing beyond what it shows in
   * clear.
   * @returns The query.
   */
  function query() {
    return {
      credentials: [
        {
          id: 'certificate',
          format: 'jwt_vc_json',
          meta: { type_values: [[type]] },
          require_cryptographic_holder_binding: true,
        },
      ],
    };
  }

  return {
    jwks: { keys: [jwk] },
    /**
     * Create an operator-owned wallet presentation offer.
     *
     * @param ownerId - Verifier owner account ID.
     * @param scope - Optional supported compatibility scope.
     * @returns State and openid request URI, or undefined for unsupported scope/authority.
     * @throws Session-store errors.
     */
    async offer(ownerId: number, scope?: string | null) {
      if (scope && scope !== defaultScope) return;
      const request = await sessions.create(ownerId, [type]);
      if (!request) return;
      const url = origin + '/presentation-requests/' + request.state;
      return {
        state: request.state,
        offer_uri:
          'openid4vp://?client_id=' +
          encodeURIComponent(request.audience) +
          '&request_uri=' +
          encodeURIComponent(url),
      };
    },

    /**
     * Sign the still-active presentation challenge for wallet retrieval.
     *
     * @param state - Opaque presentation state.
     * @returns Signed request JWT, or undefined for unavailable challenges.
     * @throws Session-store or JWT signing errors.
     */
    async requestObject(state: string) {
      const request = await sessions.challenge(state);
      if (!request) return;
      return new SignJWT({
        client_id: request.audience,
        response_uri: origin + '/auth/direct_post',
        response_type: 'vp_token',
        response_mode: 'direct_post',
        state,
        nonce: request.nonce,
        dcql_query: query(),
        client_metadata: { vp_formats_supported: { jwt_vc_json: { alg_values: ['ES256'] } } },
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'oauth-authz-req+jwt', kid })
        .setIssuer(origin)
        .setIssuedAt()
        .setExpirationTime(Math.floor(request.expiresAt.getTime() / 1000))
        .sign(privateKey);
    },

    /**
     * Take the one presentation an OpenID4VP 1.0 response carries under the query's id.
     *
     * @param options - Direct-post state and JSON vp_token fields.
     * @returns Whether the response completed the session; malformed tokens return false.
     * @throws Verification or session-store errors, including recorded holder-bound refusals.
     */
    async submit(options: Record<string, string>) {
      const { state } = options;
      const vpToken = parseVpToken(options.vp_token);
      // One presentation of one credential, under the query's id.
      if (
        !vpToken ||
        Object.keys(vpToken).join() !== 'certificate' ||
        vpToken.certificate.length !== 1
      )
        return false;
      return sessions.submit(state, vpToken.certificate[0], { expectedCount: 1 });
    },

    result: sessions.result,
    purgeAttributes: sessions.purgeAttributes,
  };
}
