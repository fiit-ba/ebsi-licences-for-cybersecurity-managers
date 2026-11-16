import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { OperatorAccount } from './accounts.ts';

/** Identity and session generation encoded in an operator token pair. */
type TokenAccount = Pick<OperatorAccount, 'id'> &
  Partial<Pick<OperatorAccount, 'username' | 'email' | 'auth_version'>>;

/**
 * Create short-lived operator token issuance and access-token validation.
 *
 * @param secret - Signing secret containing at least 32 bytes.
 * @returns Token-pair issuance and access-token account-ID extraction.
 * @throws Error if the signing secret is too short.
 */
export function operatorTokens(secret: string | undefined) {
  const key = Buffer.from(secret ?? '');
  if (key.length < 32) throw new Error('Set BACK_OFFICE_TOKEN_SECRET to at least 32 random bytes');

  const issuer = 'atest-back-office';
  /**
   * Sign an operator JWT with an explicit token purpose.
   *
   * @param account - Account identity fields.
   * @param type - Access or refresh purpose.
   * @param lifetime - JWT lifetime accepted by jose.
   * @returns The signed HS256 token.
   * @throws Signing errors from jose.
   */
  async function issue(account: TokenAccount, type: 'access' | 'refresh', lifetime: string) {
    return new SignJWT({
      token_type: type,
      auth_version: account.auth_version ?? 0,
      user_id: account.id,
      username: account.username,
      email: account.email,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(issuer)
      .setSubject(String(account.id))
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(lifetime)
      .sign(key);
  }

  return {
    /**
     * Issue an access token and a separately marked refresh token.
     *
     * @param account - Account identity to encode.
     * @returns An access token valid for 15 minutes and refresh token valid for one hour.
     * @throws Signing errors from jose.
     */
    async pair(account: TokenAccount) {
      const [access, refresh] = await Promise.all([
        issue(account, 'access', '15m'),
        issue(account, 'refresh', '1h'),
      ]);
      return { access, refresh };
    },
    /**
     * Validate an access JWT and extract its bound account ID.
     *
     * @param token - Untrusted compact JWT.
     * @param expectedVersion - Optional current account generation; mismatches invalidate the session.
     * @returns A positive account ID, or undefined for invalid, expired or refresh tokens.
     */
    async accountId(token: string | undefined, expectedVersion?: number) {
      try {
        const { payload } = await jwtVerify(token!, key, {
          algorithms: ['HS256'],
          issuer,
          requiredClaims: ['exp', 'sub', 'auth_version'],
        });
        const id = payload.user_id;
        if (
          payload.token_type === 'access' &&
          typeof id === 'number' &&
          Number.isInteger(id) &&
          id > 0 &&
          id <= 2147483647 &&
          payload.sub === String(id) &&
          Number.isInteger(payload.auth_version) &&
          Number(payload.auth_version) >= 0 &&
          (expectedVersion === undefined || payload.auth_version === expectedVersion)
        )
          return id;
      } catch {
        return undefined;
      }
    },
  };
}
