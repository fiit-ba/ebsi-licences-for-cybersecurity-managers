// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * The trust chain the signed-in RootTAO or TAO oversees (design decisions D15).
 * @returns The current organization hierarchy, available schemas and selected descendants.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function trustChain() {
  return backendRequest('/registry/trust-chain/');
}

/**
 * Select an organization one level below, accredited for schemas. A TI is
 * accredited until `accreditedUntil` (design decisions D23); a TAO has no end.
 * @param name - Selected organization name.
 * @param contactEmail - Organization contact email.
 * @param schemas - Existing delegated credential-type identifiers.
 * @param accreditedUntil - Optional TI accreditation end timestamp.
 * @returns The selected organization and its one-time invitation details.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function selectOrganization(name, contactEmail, schemas = [], accreditedUntil = null) {
  return backendRequest('/registry/trust-chain/select/', {
    method: 'POST',
    body: {
      name,
      contact_email: contactEmail,
      schemas,
      ...(accreditedUntil ? { accredited_until: accreditedUntil } : {}),
    },
  });
}

/**
 * Extend or shorten a TI's accreditation (`{accredited_until}`), or end it at
 * once (`{end_now: true}`). Only the TAO that selected it can (D23).
 * @param organizationId - Selected organization identifier.
 * @param change - Existing rule-change or accreditation-lifespan payload.
 * @returns The existing updated accreditation response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function setOrganizationLifespan(organizationId, change) {
  return backendRequest('/registry/trust-chain/lifespan/', {
    method: 'POST',
    body: { organization_id: organizationId, ...change },
  });
}

/**
 * Revoke an organization's accreditation for good (design decisions D24): the
 * RootTAO a TAO's, a TAO a TI's. `reason` is one of ORGANIZATION_REVOCATION_REASONS;
 * `other` needs a note.
 * @param organizationId - Selected organization identifier.
 * @param reason - Recorded revocation reason code.
 * @param note - Existing optional reason note.
 * @returns The existing revocation result and affected-certificate counts.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function revokeOrganization(organizationId, reason, note = '') {
  return backendRequest('/registry/trust-chain/revoke/', {
    method: 'POST',
    body: { organization_id: organizationId, reason, note },
  });
}

/**
 * Change which schemas an organization one level below may attest.
 * @param organizationId - Selected organization identifier.
 * @param schemas - Existing delegated credential-type identifiers.
 * @returns The existing updated delegation response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function setOrganizationSchemas(organizationId, schemas) {
  return backendRequest('/registry/trust-chain/schemas/', {
    method: 'POST',
    body: { organization_id: organizationId, schemas },
  });
}

/**
 * A new invitation for an organization that has not registered yet.
 * @param organizationId - Selected organization identifier.
 * @returns The replacement one-time invitation and its expiry.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function renewInvitation(organizationId) {
  return backendRequest('/registry/trust-chain/invitation/', {
    method: 'POST',
    body: { organization_id: organizationId },
  });
}

/**
 * Register a selected organization's account with its invitation; no sign-in needed.
 * @param invitation - One-time organization invitation or holder-exchange invitation expected by the selected endpoint.
 * @param username - Operator username.
 * @param password - Operator password supplied for the existing authentication or registration request.
 * @returns The existing successful organization-registration response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function registerOrganization(invitation, username, password) {
  return backendRequest('/organizations/v1/registrations/', {
    method: 'POST',
    body: { invitation, username, password },
    auth: false,
  });
}
