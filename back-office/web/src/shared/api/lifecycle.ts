// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * A page of the issued certificates, with the actions open on each. `q`
 * searches and `state` filters on the back-office, over all of them; the
 * answer says how many match (`total`), where the next page starts (`next`)
 * and how many the operator's scope holds by state (`summary`).
 * @param params - Existing query parameters or translation placeholders.
 * @returns The existing certificate rows, total, next offset and state summary.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function listCertificates(params = {}) {
  const query = new URLSearchParams(params).toString();
  return backendRequest(`/registry/certificates/${query ? `?${query}` : ''}`);
}

/**
 * Open status-change cases, with whether this operator may approve each, and how many are open (`total`).
 * @param params - Existing query parameters or translation placeholders.
 * @returns The existing open cases, actor permissions and total count.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function listProposals(params = {}) {
  const query = new URLSearchParams(params).toString();
  return backendRequest(`/registry/proposals/${query ? `?${query}` : ''}`);
}

/**
 * Propose a lifecycle transition. Needs a second, different approver.
 * @param payload - Existing JSON payload required by the selected backend endpoint.
 * @returns The existing proposal identifier, action, certificate state and approval wait.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function proposeChange(payload) {
  return backendRequest('/registry/propose/', { method: 'POST', body: payload });
}

/**
 * Approve as the second person (four-eyes). Applies at once without governance.
 * @param proposalId - Ledger status-proposal identifier.
 * @returns The existing applied flag, wait reason and certificate state.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function approveProposal(proposalId) {
  return backendRequest('/registry/approve/', {
    method: 'POST',
    body: { proposal_id: proposalId },
  });
}

/**
 * Reject the selected open case through the existing independent-decision endpoint.
 * @param proposalId - Ledger status-proposal identifier.
 * @returns The existing proposal identifier and rejected flag.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function rejectProposal(proposalId) {
  return backendRequest('/registry/reject/', { method: 'POST', body: { proposal_id: proposalId } });
}

/**
 * Suspend at once on one approval, for a compromised key (component 10.6).
 * @param credentialId - Existing certificate identifier understood by the registry.
 * @param reasonCode - Existing status-change reason code.
 * @param reasonNote - Existing optional status-change reason note.
 * @returns The existing immediate suspension response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function emergencySuspend(credentialId, reasonCode, reasonNote = '') {
  return backendRequest('/registry/emergency-suspend/', {
    method: 'POST',
    body: {
      credential_id: credentialId,
      reason_code: reasonCode || 'key_compromise',
      reason_note: reasonNote,
    },
  });
}

/**
 * A fresh offer and PIN for a certificate not yet collected.
 * @param credentialId - Existing certificate identifier understood by the registry.
 * @returns The existing fresh holder offer, PIN and expiry.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function reoffer(credentialId) {
  return backendRequest('/registry/reoffer/', {
    method: 'POST',
    body: { credential_id: credentialId },
  });
}
