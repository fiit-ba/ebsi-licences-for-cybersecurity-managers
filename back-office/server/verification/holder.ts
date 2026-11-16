import { importJWK, jwtVerify } from 'jose';
import { decodeHolderKey } from '../issuance/holder-proof.ts';
import { unverified, severity } from './outcomes.ts';
import type { PresentationOutcome } from './outcomes.ts';
import type { credentialEvaluator } from './evaluate.ts';

/**
 * Verify the holder signature, nonce, audience and optional exchange age limit.
 * @param token - Untrusted holder-signed JWT-VP.
 * @param constraints - Current nonce/domain, optional state and exchange maximum age.
 * @returns Verified holder DID, or undefined for any invalid presentation binding.
 */
export async function presentationHolder(
  token: string,
  constraints: { nonce: string; audience: string; state?: string; maxAge?: number; now?: Date },
) {
  try {
    const { header, payload } = unverified(token);
    const did = payload.iss;
    const key = decodeHolderKey(did);
    if (
      !key ||
      header.alg !== 'ES256' ||
      typeof header.kid !== 'string' ||
      header.kid.split('#')[0] !== did ||
      payload.aud !== constraints.audience ||
      payload.nonce !== constraints.nonce
    )
      return;
    const exchange = constraints.maxAge !== undefined;
    await jwtVerify(token, await importJWK(key, 'ES256'), {
      algorithms: ['ES256'],
      audience: constraints.audience,
      currentDate: constraints.now,
      clockTolerance: exchange ? 60 : 5,
      ...(exchange ? { requiredClaims: ['iat'] } : {}),
    });
    if (exchange) {
      const now = +(constraints.now ?? new Date());
      if (
        !Number.isFinite(payload.iat) ||
        payload.iat * 1000 < now - constraints.maxAge! * 1000 ||
        payload.iat * 1000 > now + 60_000
      )
        return;
    }
    if ((payload.sub ?? did) !== did || (payload.vp?.holder ?? did) !== did) return;
    // Bind DirectRequest nonces to the expected state explicitly
    // to prevent a holder from writing the outcome into another request.
    if (constraints.state !== undefined && payload.state !== constraints.state) return;
    if (!exchange && !payload.vp?.type?.includes('VerifiablePresentation')) return;
    return did as string;
  } catch {
    return;
  }
}

/**
 * Decode the presentation credential list without accepting it as verified.
 * @param token - JWT-VP received from the holder.
 * @returns String credentials, or an empty list for malformed/missing contents.
 */
export function presentationCredentials(token: string): string[] {
  try {
    const { payload } = unverified(token);
    const values = (payload.vp ?? payload).verifiableCredential || [];
    return (typeof values === 'string' ? [values] : values).filter(
      (item: unknown) => typeof item === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Aggregate all credential decisions; the most severe refusal wins.
 * @param verify - Credential evaluator.
 * @returns Presentation evaluator retaining each credential's own evidence.
 */
export function presentationEvaluator(verify: ReturnType<typeof credentialEvaluator>) {
  /**
   * Evaluate every credential against the presenting holder and envelope result.
   * @param token - Signed JWT-VP.
   * @param options - Envelope decision, optional evaluation clock and fresh-read context.
   * @returns Aggregate outcome, never a bare boolean or first-error exception.
   */
  return async function verifyPresentation(
    token: string,
    options: { presentationVerified?: boolean; now?: Date; fresh?: boolean } = {},
  ): Promise<PresentationOutcome> {
    const credentials = presentationCredentials(token);
    if (!credentials.length)
      return {
        state: 'INDETERMINATE',
        reason: 'The presentation carried no credential',
        acceptable: false,
        credential_types: [],
      };
    let holder;
    try {
      const { payload } = unverified(token);
      holder = payload.iss || payload.vp?.holder;
    } catch {
      /* The empty-list branch covers malformed JWTs. */
    }
    const results = [];
    for (const credential of credentials)
      results.push(
        await verify(credential, {
          ...options,
          holder,
          presentationVerified: options.presentationVerified ?? true,
        }),
      );
    const worst = results.reduce((left, right) =>
      severity.indexOf(left.state) <= severity.indexOf(right.state) ? left : right,
    );
    const types = [
      ...new Set(
        credentials.flatMap((credential) => {
          try {
            const { payload } = unverified(credential.split('~')[0]);
            return payload.vc?.type ?? payload.type ?? [];
          } catch {
            return [];
          }
        }),
      ),
    ] as string[];
    return {
      state: worst.state,
      reason: worst.reason,
      statusPurpose: worst.statusPurpose,
      acceptable: results.every((item) => item.state === 'VALID'),
      credential_types: types,
      checks: worst.checks,
      credentials: results,
    };
  };
}
