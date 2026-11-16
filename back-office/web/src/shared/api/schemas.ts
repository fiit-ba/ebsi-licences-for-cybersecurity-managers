// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * The certificate schemas and their versions, and whether this account defines them (D17).
 * @returns The existing schema catalog, versions and editing/publication capabilities.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function listSchemas() {
  return backendRequest('/registry/schemas/');
}

/**
 * The RootTAO defines a schema, or the next version of one.
 * @param body - Existing JSON request body.
 * @returns The existing saved schema draft response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function proposeSchema(body) {
  return backendRequest('/registry/schemas/', { method: 'POST', body });
}

/**
 * Record the identifier EBSI's TSR gave a version (production).
 * @param credentialType - Existing credential type identifier.
 * @param version - Existing schema version number.
 * @param tsrId - Trusted schema registry identifier.
 * @returns The existing schema-version registration result.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function confirmSchema(credentialType, version, tsrId) {
  return backendRequest('/registry/schemas/confirm/', {
    method: 'POST',
    body: { credential_type: credentialType, version, tsr_id: tsrId },
  });
}

/**
 * Issue a schema no more; its certificates go on verifying.
 * @param credentialType - Existing credential type identifier.
 * @returns The existing schema retirement result.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function retireSchema(credentialType) {
  return backendRequest('/registry/schemas/retire/', {
    method: 'POST',
    body: { credential_type: credentialType },
  });
}
