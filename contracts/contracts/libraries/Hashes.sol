// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

/**
 * @title Hashes
 * @notice What the chain computes and keeps in place of the values themselves:
 *         the salted commitment of a status change's reason (D22), and a
 *         certificate's id hash and record key (D41).
 *
 * @dev A certificate has no salted commitment any more (D42): its record is
 *      public, so a salt would hide nothing. `abi.encode` length-prefixes every
 *      dynamic value. SHA-256, not keccak256: gas doesn't matter here,
 *      auditor-recomputable everywhere matters more. The back-office mirrors
 *      this in Python (`eth_abi`, plr/services/commitment.py);
 *      test/CommitmentInterop.t.sol checks both.
 */
library Hashes {
    /// @dev Domain of a reason's commitment (DECISIONS.md D22).
    string internal constant REASON_DOMAIN = "PLR-REASON-V1";

    /// @dev A status change's reason, committed to (D22):
    ///      SHA-256(abi.encode("PLR-REASON-V1", reasonCode, reasonNote, salt)).
    ///      `reasonCode` is the back-office's category, `reasonNote` its
    ///      words, salt the proposal's own 256 bits - without it a category
    ///      has too few values to hide and its bare hash would publish it
    ///      (10.3). The ledger shows a reason was fixed, not which.
    function reason(string memory reasonCode, string memory reasonNote, bytes32 salt) internal pure returns (bytes32) {
        return sha256(abi.encode(REASON_DOMAIN, reasonCode, reasonNote, salt));
    }

    /// @dev Domain of a certificate's status key (DECISIONS.md D41).
    string internal constant CERTIFICATE_DOMAIN = "PLR-CERTIFICATE-V4";

    /// @dev Domain of a credential id's hash (D40).
    string internal constant CERTIFICATE_ID_DOMAIN = "PLR-CERTIFICATE-ID-V1";

    /// @dev What the chain holds of a credential's id.
    function certificateIdHash(string memory certificateId) internal pure returns (bytes32) {
        return sha256(abi.encode(CERTIFICATE_ID_DOMAIN, certificateId));
    }

    /// @dev A certificate's record key (D41):
    ///      SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash)).
    ///      A verifier computes it from what every presentation shows. The
    ///      contract computes it too, so a TI can only ever take a key of its own.
    function statusKey(string memory issuerDid, bytes32 certificateIdHash_) internal pure returns (bytes32) {
        return sha256(abi.encode(CERTIFICATE_DOMAIN, issuerDid, certificateIdHash_));
    }
}
