import { verifyDidKeyJwt } from '../issuance/holder-proof.ts';
import { CredentialVerificationError } from './credential.ts';
import type { VerifyCredential, VerifyPresentation } from './types.ts';

const maxPresentationBytes = 256 * 1024;
const maxCredentials = 8;

/**
 * Create holder-bound presentation verification for a credential verifier.
 *
 * @param verifyCredential - Credential verification operation.
 * @returns An operation validating a presentation against its challenge.
 */
export function presentationVerifier(verifyCredential: VerifyCredential): VerifyPresentation {
  /**
   * Validate a signed presentation and each uniquely identified embedded credential.
   *
   * @param token - Untrusted compact presentation JWT.
   * @param options - Audience, nonce, optional state/type/count constraints and clock.
   * @returns Verified credential evidence with disclosed claims, excluding the holder subject
   * field.
   * @throws CredentialVerificationError for invalid presentation/binding or duplicate credentials;
   * credential verifier errors.
   */
  async function verifyPresentation(
    token: string,
    options: {
      audience: string;
      nonce: string;
      state?: string;
      credentialTypes?: string[];
      expectedCount?: number;
      now?: Date;
    },
  ) {
    const { audience, nonce, state, credentialTypes, expectedCount, now = new Date() } = options;

    if (
      typeof token !== 'string' ||
      token.length > maxPresentationBytes ||
      typeof nonce !== 'string' ||
      !nonce ||
      typeof audience !== 'string' ||
      !audience
    ) {
      throw new CredentialVerificationError('InvalidPresentation');
    }

    const signed = await verifyDidKeyJwt(token, { audience, typ: 'JWT', maxAge: 900, now });
    if (!signed) throw new CredentialVerificationError('InvalidPresentationSignature');
    const { did, payload } = signed;
    const vp = payload.vp as { holder?: string; type?: string[]; verifiableCredential?: string[] };
    const credentials = vp?.verifiableCredential;
    // OpenID4VP 1.0 binds a presentation to its request by nonce and audience (the client id);
    // the state travels beside the vp_token, not in it.
    if (
      payload.nonce !== nonce ||
      (payload.state !== undefined && payload.state !== state) ||
      payload.sub !== did ||
      vp?.holder !== did
    ) {
      throw new CredentialVerificationError('InvalidPresentationBinding');
    }
    if (
      !Array.isArray(vp.type) ||
      !vp.type.includes('VerifiablePresentation') ||
      !Array.isArray(credentials) ||
      !credentials.length ||
      credentials.length > maxCredentials ||
      (expectedCount !== undefined && credentials.length !== expectedCount) ||
      credentials.some((value) => typeof value !== 'string' || !value)
    ) {
      throw new CredentialVerificationError('InvalidPresentation');
    }

    const results = [];
    const seen = new Set();
    for (const token of credentials) {
      const result = await verifyCredential(token, { expectedHolder: did, credentialTypes, now });
      if (seen.has(result.credentialId))
        throw new CredentialVerificationError('DuplicateCredential');
      if (credentialTypes?.length && !credentialTypes.includes(result.type)) {
        throw new CredentialVerificationError('UnexpectedCredentialType');
      }
      seen.add(result.credentialId);
      const { subject: _subject, ...disclosed } = result;
      results.push(disclosed);
    }
    return results;
  }
  return verifyPresentation;
}
