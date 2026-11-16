// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { backendRequest } from './client.ts';

/**
 * The audit log (auditor), optionally for one certificate.
 * @param credentialId - Existing certificate identifier understood by the registry.
 * @returns The existing journal rows and chain-integrity report.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function auditLog(credentialId) {
  const query = credentialId ? `?credential_id=${encodeURIComponent(credentialId)}` : '';
  return backendRequest(`/registry/audit/${query}`);
}

/**
 * A certificate's anchored decisions, each read back from the ledger.
 * @param credentialId - Existing certificate identifier understood by the registry.
 * @returns The existing certificate timestamp evidence read back from the ledger.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function anchors(credentialId) {
  return backendRequest(`/registry/anchors/?credential_id=${encodeURIComponent(credentialId)}`);
}

/**
 * A proposal's reason, its note and salt, to check against the chain (D22). Recorded.
 * @param onchainProposalId - Ledger proposal identifier used for the recorded disclosure.
 * @returns The recorded reason code, note and salt disclosed for the requested ledger proposal.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function reasonPreimage(onchainProposalId) {
  return backendRequest('/registry/audit/reason-preimage/', {
    method: 'POST',
    body: { onchain_proposal_id: String(onchainProposalId) },
  });
}

/**
 * The issuer DID, collected credential id and record key for the component 10.7 audit. Every call is recorded.
 * @param credentialId - Existing certificate identifier understood by the registry.
 * @returns The recorded issuer DID, certificate number, credential id and record key.
 * @throws Backend refusal, request timeout or network errors from the existing request client.
 */
export function commitmentPreimage(credentialId) {
  return backendRequest('/registry/audit/commitment-preimage/', {
    method: 'POST',
    body: { credential_id: credentialId },
  });
}
