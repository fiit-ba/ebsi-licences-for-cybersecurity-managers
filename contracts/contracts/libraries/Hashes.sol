pragma solidity 0.8.26;

/**
 * @title Hashes
 * @notice What the chain computes and keeps in place of the values themselves:
 *         the salted commitment of a status change's reason, and a
 *         certificate's id hash and record key.
 *
 * @dev A certificate has no salted commitment any more: its record is
 *      public, so a salt would hide nothing. `abi.encode` length-prefixes every
 *      dynamic value. SHA-256, not keccak256: it costs a few hundred gas more
 *      per hash, little next to the registry calls around it, and every
 *      language's standard library can recompute it for an audit. Other
 *      implementations (the issuer's back-office, a wallet, a verifier) check
 *      themselves against test/vectors/hashes.json, as test/HashVectors.t.sol
 *      checks this one.
 */
library Hashes {
    /// @dev Domain of a reason's commitment.
    string internal constant REASON_DOMAIN = "PLR-REASON-V1";

    /// @dev A status change's reason, committed to:
    ///      SHA-256(abi.encode("PLR-REASON-V1", reasonCode, reasonNote, salt)).
    ///      `reasonCode` is the back-office's category, `reasonNote` its
    ///      words, salt the proposal's own 256 bits - without it a category
    ///      has too few values to hide and its bare hash would publish it
    ///      (10.3). The ledger shows a reason was fixed, not which.
    function reason(string memory reasonCode, string memory reasonNote, bytes32 salt) internal pure returns (bytes32) {
        return sha256(abi.encode(REASON_DOMAIN, reasonCode, reasonNote, salt));
    }

    /// @dev Domain of a certificate's status key.
    string internal constant CERTIFICATE_DOMAIN = "PLR-CERTIFICATE-V4";

    /// @dev Domain of a credential id's hash.
    string internal constant CERTIFICATE_ID_DOMAIN = "PLR-CERTIFICATE-ID-V1";

    /// @dev What the chain holds of a credential's id.
    function certificateIdHash(string memory certificateId) internal pure returns (bytes32) {
        return sha256(abi.encode(CERTIFICATE_ID_DOMAIN, certificateId));
    }

    /// @dev A certificate's record key:
    ///      SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash)).
    ///      A verifier computes it from what every presentation shows. The
    ///      contract computes it too, so a TI can only ever take a key of its own.
    function statusKey(string memory issuerDid, bytes32 certificateIdHash_) internal pure returns (bytes32) {
        return sha256(abi.encode(CERTIFICATE_DOMAIN, issuerDid, certificateIdHash_));
    }
}
