// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

/// @notice The part of EBSI's DID Registry this contract reads.
interface IEbsiDidRegistry {
    /// @notice True while `controller` holds a valid capabilityInvocation key of `did`.
    function checkController(bytes calldata did, address controller) external view returns (bool);
}

/// @notice The part of EBSI's Trusted Issuers Registry this contract reads.
///         Mirrors its ABI; local/ebsi-mock is off limits to contracts/.
interface IEbsiIssuersRegistry {
    enum IssuerType {
        Undefined,
        RootTAO,
        TAO,
        TI,
        Revoked
    }

    struct Attribute {
        string did;
        bytes32 attributeId;
        bytes attribData;
        string tao;
        string rootTao;
        IssuerType issuerType;
        bytes32 parentAttributeId;
    }

    function getLatestRevisionAttribute(string calldata issuerDid, bytes32 attributeId)
        external
        view
        returns (Attribute memory attribute);
}
