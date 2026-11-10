// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IEbsiDidRegistry, IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// Every key controls every DID, so a test about something else need not set
/// them up. test/EbsiTrustChain.t.sol runs against the real registries.
contract StubDidRegistry is IEbsiDidRegistry {
    function checkController(bytes calldata, address) external pure returns (bool) {
        return true;
    }
}

/// Whatever was accredited here, and a revert for anything else, as the registry.
contract StubIssuersRegistry is IEbsiIssuersRegistry {
    mapping(bytes32 => Attribute) private attributes;

    function accredit(string calldata did, bytes32 attributeId, IssuerType kind, string calldata tao, bytes32 parent)
        external
    {
        attributes[keccak256(abi.encode(did, attributeId))] = Attribute(did, attributeId, "", tao, "", kind, parent);
    }

    function getLatestRevisionAttribute(string calldata did, bytes32 attributeId)
        external
        view
        returns (Attribute memory attribute)
    {
        attribute = attributes[keccak256(abi.encode(did, attributeId))];
        require(attribute.issuerType != IssuerType.Undefined, "no such attribute");
    }
}
