pragma solidity 0.8.26;

import {IEbsiDidRegistry, IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// Every key controls every DID, so a test about something else need not set
/// them up, except a DID whose keys a test listed (`setController`): that one
/// has those keys alone. test/EbsiTrustChain.t.sol runs against the real
/// registries.
contract StubDidRegistry is IEbsiDidRegistry {
    mapping(bytes32 => bool) private listed;
    mapping(bytes32 => mapping(address => bool)) private valid;

    function setController(string calldata did, address key, bool isValid) external {
        bytes32 id = keccak256(bytes(did));
        listed[id] = true;
        valid[id][key] = isValid;
    }

    function checkController(bytes calldata did, address controller) external view returns (bool) {
        bytes32 id = keccak256(did);
        return !listed[id] || valid[id][controller];
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
