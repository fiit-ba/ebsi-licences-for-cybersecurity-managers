// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * The schemas the signed-in TI may issue, what each says (D16, D17), and its name.
 * @returns The existing issuer schemas, current fields and organization defaults.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function certificateScheme() {
  return backendRequest('/registry/certificate-scheme/');
}

/**
 * Ask for a certificate to be issued, the way a certification body does.
 *
 * Registers the certificate with its attributes under its number - once per
 * TI, the key of its record on the governance contract (D36) - and returns an
 * OID4VCI offer that issues exactly it.
 * @param payload - Existing JSON payload required by the selected backend endpoint.
 * @returns The existing certificate identifier, holder offer URI, PIN and offer expiry.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function issueCertificate(payload) {
  return backendRequest('/registry/issue/', { method: 'POST', body: payload });
}
