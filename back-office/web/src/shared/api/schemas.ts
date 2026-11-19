// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * The certificate schemas read from EBSI's Trusted Schemas Registry, with their versions and the
 * registry ids this installation uses. Read-only: the Support Office registers schemas there.
 * @returns The registry ids and the stored schemas.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function listSchemas() {
  return backendRequest('/registry/schemas/');
}
