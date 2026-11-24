pragma solidity 0.8.26;

import {IEbsiDidRegistry, IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// Every key controls every DID unless a test takes it away, so a test about
/// something else need not set them up. test/EbsiTrustChain.t.sol runs
/// against the real registries.
contract StubDidRegistry is IEbsiDidRegistry {
    mapping(bytes32 => mapping(address => bool)) private revoked;

    /// The key stops (or starts again) controlling the DID, as a key
    /// revoked in (or added back to) its DID document.
    function setController(bytes calldata did, address controller, bool valid) external {
        revoked[keccak256(did)][controller] = !valid;
    }

    function checkController(bytes calldata did, address controller) external view returns (bool) {
        return !revoked[keccak256(did)][controller];
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
