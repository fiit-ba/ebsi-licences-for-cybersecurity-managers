// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * What this console may vote with on the governance contract: the role keys
 * the backend may sign with on an operator's behalf.
 * @returns The enabled state, permitted roles, role addresses and current backend policy bounds.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function governanceRoles() {
  return backendRequest('/registry/governance/roles/');
}

/**
 * Vote on an on-chain proposal with a KMS-backed role key.
 * @param proposalId - Ledger status-proposal identifier.
 * @param vote - Existing sign, execute, cancel, expire or propose operation.
 * @param role - Existing signer role identifier.
 * @returns The existing vote response, including approval and submitted transaction details.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function governanceVote(proposalId, vote, role) {
  return backendRequest('/registry/governance/vote/', {
    method: 'POST',
    body: { proposal_id: String(proposalId), vote, role },
  });
}

/**
 * Open, co-sign, execute or veto a change to the contract's rules with a role key.
 * @param body - Existing JSON request body.
 * @returns The existing submitted rule-change vote or proposal response.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function governanceAdmin(body) {
  return backendRequest('/registry/governance/admin/', { method: 'POST', body });
}

/**
 * Ask what the back-office would say to opening or co-signing a rule change.
 * @param body - Existing JSON request body.
 * @returns The existing allowed/refused verdict and supervisory co-signing requirements.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function governanceCheck(body) {
  return backendRequest('/registry/governance/admin/check/', { method: 'POST', body });
}

/**
 * Ask the back-office to re-read a proposal voted on from a wallet.
 * @param proposalId - Ledger status-proposal identifier.
 * @returns The existing backend reconciliation result after an external wallet vote.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function governanceSync(proposalId) {
  return backendRequest('/registry/governance/sync/', {
    method: 'POST',
    body: { proposal_id: String(proposalId) },
  });
}
