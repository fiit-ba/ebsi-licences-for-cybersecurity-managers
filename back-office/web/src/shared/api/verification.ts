// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * How long the console waits for the Verifier Service to answer about a
 * presentation. One answer may cover asking the holder's wallet and reading
 * EBSI's registries and the governance contract, each allowed 30 s on a slow
 * connection; it stays under the 180 s the production proxy waits
 * (infra/prod/nginx).
 */
const VERIFICATION_TIMEOUT_MS = 170000;

/**
 * A presentation request for a holder to scan (component 6).
 *
 * Returns the `openid://` URI and the state to poll the outcome with.
 * @param scope - Optional presentation scope passed unchanged to the verifier service.
 * @returns The existing presentation offer URI and polling state.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function presentationOffer(scope?: string) {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  return backendRequest(`/registry/presentation-offer/${query}`);
}

/**
 * Outcome of a presentation, or `{status: 'pending'}` until one arrives.
 * @param state - Existing proposal, certificate or presentation state identifier.
 * @returns The existing pending/progress state or completed verification evidence and disclosure deadline.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function presentationResult(state) {
  return backendRequest(`/registry/presentation-result/?state=${encodeURIComponent(state)}`, {
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });
}

/**
 * Ask the wallet behind a holder's QR code for the certificate (design decisions
 * D35): the Verifier Service connects to the exchange the code names.
 *
 * Returns the state to poll the outcome with, as for a presentation request.
 * @param invitation - One-time organization invitation or holder-exchange invitation expected by the selected endpoint.
 * @returns The existing holder-exchange polling state and expiry.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function presentationExchange(invitation) {
  return backendRequest('/registry/presentation-exchange/', {
    method: 'POST',
    body: { invitation },
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });
}
