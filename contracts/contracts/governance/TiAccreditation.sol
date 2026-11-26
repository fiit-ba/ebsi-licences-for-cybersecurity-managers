pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IEbsiDidRegistry, IEbsiIssuersRegistry} from "../interfaces/IEbsiRegistries.sol";
import {ITiAccreditation} from "../interfaces/ITiAccreditation.sol";

/**
 * @title TiAccreditation
 * @notice The EBSI registries this contract trusts, and the question it asks
 *         them: is this TI accredited right now? The registries are
 *         immutables of the implementation, given to its constructor: every
 *         proxy on the beacon reads them from the implementation's code, and
 *         no transaction changes them. On EBSI their addresses are fixed, so a
 *         key that could repoint them (the TAO's, if it were compromised)
 *         would only be a risk. Each network deploys its own implementation
 *         with its own registries; should EBSI ever move one, a new
 *         implementation version carries the change.
 *
 *         The TAO is its DID: any valid key of `taoDid` acts as the TAO.
 */
abstract contract TiAccreditation is ITiAccreditation, Initializable {
    /// @notice Most accreditation hops walked above a TI: the registry's own
    ///         limit, so a chain cannot be longer. Each hop is one more read
    ///         of the Trusted Issuers Registry, and so more gas wherever gas is
    ///         charged (EBSI's production network; its PILOT charges none).
    uint8 public constant MAX_TRUST_CHAIN_DEPTH = 32;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable DID_REGISTRY;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable ISSUERS_REGISTRY;

    /// @custom:storage-location erc7201:plr.storage.TiAccreditation
    struct AccreditationStorage {
        string taoDid;
    }

    /// @dev `cast index-erc7201 plr.storage.TiAccreditation`
    bytes32 private constant ACCREDITATION_STORAGE = 0xc44874b0161ad34163ab7904889d7de3b99753762fb6685ad7f52e4a2ff97500;

    function _accreditationStorage() private pure returns (AccreditationStorage storage $) {
        assembly ("memory-safe") {
            $.slot := ACCREDITATION_STORAGE
        }
    }

    /// @dev Runs once, when the implementation is deployed: what it wrote to
    ///      storage no proxy would see, so it sets only the immutables.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address didRegistry_, address issuersRegistry_) {
        if (didRegistry_.code.length == 0 || issuersRegistry_.code.length == 0) revert InvalidRegistry();
        DID_REGISTRY = didRegistry_;
        ISSUERS_REGISTRY = issuersRegistry_;
    }

    /// @inheritdoc ITiAccreditation
    function didRegistry() public view returns (address) {
        return DID_REGISTRY;
    }

    /// @inheritdoc ITiAccreditation
    function issuersRegistry() public view returns (address) {
        return ISSUERS_REGISTRY;
    }

    /// @inheritdoc ITiAccreditation
    function taoDid() public view returns (string memory) {
        return _accreditationStorage().taoDid;
    }

    /// @dev A current key of the TAO's DID.
    modifier onlyTao() {
        if (!_controls(taoDid(), msg.sender)) revert NotDidController();
        _;
    }

    /// @dev Called once, by `initialize`: there is no other way to set it.
    function _setTaoDid(string memory taoDid_) internal {
        if (bytes(taoDid_).length == 0) revert InvalidTaoDid();
        _accreditationStorage().taoDid = taoDid_;
    }

    /// @dev Asks the Trusted Issuers Registry, on every call, whether the
    ///      accreditation `attributeId` of `did` is live. In their latest
    ///      revisions:
    ///      1. the attribute exists and its type is `TI`, not `Revoked`;
    ///      2. its `tao` is this contract's `taoDid`, so a TI accredited by
    ///         another TAO is not active here;
    ///      3. every parent, followed through `tao` and `parentAttributeId`,
    ///         exists and is a `TAO`, up to a `RootTAO`. A path that reaches none
    ///         within `MAX_TRUST_CHAIN_DEPTH` is not active.
    ///      The path is walked here because the registry keeps a TI's type on
    ///      its own attribute only: revoking a TAO leaves its TIs reading `TI`,
    ///      and the check that would notice is internal to the registry.
    ///      `attribData` is not read; the end date is `accreditedUntil`.
    function isActiveTi(string memory did, bytes32 attributeId) public view returns (bool) {
        (bool found, IEbsiIssuersRegistry.Attribute memory attribute) = _latest(did, attributeId);
        if (!found || attribute.issuerType != IEbsiIssuersRegistry.IssuerType.TI) return false;
        if (keccak256(bytes(attribute.tao)) != keccak256(bytes(taoDid()))) return false;

        for (uint8 depth = 0; depth < MAX_TRUST_CHAIN_DEPTH; depth++) {
            (found, attribute) = _latest(attribute.tao, attribute.parentAttributeId);
            if (!found) return false;
            if (attribute.issuerType == IEbsiIssuersRegistry.IssuerType.RootTAO) return true;
            if (attribute.issuerType != IEbsiIssuersRegistry.IssuerType.TAO) return false;
        }
        return false;
    }

    /// @dev Asks the DID Registry whether `account` holds a valid
    ///      capabilityInvocation key of `did` right now, so a key that registry
    ///      no longer shows stops counting at once. An unknown DID reverts in the
    ///      registry; here it controls nothing.
    function _controls(string memory did, address account) internal view returns (bool) {
        try IEbsiDidRegistry(DID_REGISTRY).checkController(bytes(did), account) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /// @dev Reads the latest revision of an attribute from the Trusted Issuers
    ///      Registry, the one a revocation changes. An unknown DID or attribute
    ///      reverts in the registry; here it is simply not active.
    function _latest(string memory did, bytes32 attributeId)
        private
        view
        returns (bool found, IEbsiIssuersRegistry.Attribute memory attribute)
    {
        try IEbsiIssuersRegistry(ISSUERS_REGISTRY).getLatestRevisionAttribute(did, attributeId) returns (
            IEbsiIssuersRegistry.Attribute memory latest
        ) {
            return (true, latest);
        } catch {
            return (false, attribute);
        }
    }
}
