// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IEbsiDidRegistry, IEbsiIssuersRegistry} from "../interfaces/IEbsiRegistries.sol";
import {ITiAccreditation} from "../interfaces/ITiAccreditation.sol";

/**
 * @title TiAccreditation
 * @notice The EBSI registries this contract trusts, and the question it asks
 *         them: is this TI accredited right now? The TAO can repoint them
 *         (`setRegistries`), which is as far as a TI can trust the TAO.
 */
abstract contract TiAccreditation is ITiAccreditation, OwnableUpgradeable {
    /// @notice Most accreditation hops walked above a TI: the registry's own
    ///         limit. A chain cannot be longer, and EBSI charges no gas.
    uint8 public constant MAX_TRUST_CHAIN_DEPTH = 32;

    /// @custom:storage-location erc7201:plr.storage.TiAccreditation
    struct AccreditationStorage {
        address didRegistry;
        address issuersRegistry;
        string taoDid;
    }

    /// @dev `cast index-erc7201 plr.storage.TiAccreditation`
    bytes32 private constant ACCREDITATION_STORAGE = 0xc44874b0161ad34163ab7904889d7de3b99753762fb6685ad7f52e4a2ff97500;

    function _accreditationStorage() private pure returns (AccreditationStorage storage $) {
        assembly ("memory-safe") {
            $.slot := ACCREDITATION_STORAGE
        }
    }

    /// @inheritdoc ITiAccreditation
    function didRegistry() public view returns (address) {
        return _accreditationStorage().didRegistry;
    }

    /// @inheritdoc ITiAccreditation
    function issuersRegistry() public view returns (address) {
        return _accreditationStorage().issuersRegistry;
    }

    /// @inheritdoc ITiAccreditation
    function taoDid() public view returns (string memory) {
        return _accreditationStorage().taoDid;
    }

    /// @dev The owner, while the DID Registry still shows it as the TAO's key.
    modifier onlyTao() {
        _checkOwner();
        if (!_controls(taoDid(), msg.sender)) revert NotDidController();
        _;
    }

    function _setRegistries(string memory taoDid_, address didRegistry_, address issuersRegistry_) internal {
        if (bytes(taoDid_).length == 0) revert InvalidTaoDid();
        _accreditationStorage().taoDid = taoDid_;
        _storeRegistries(didRegistry_, issuersRegistry_);
    }

    /// @dev Without an owner nothing here could change again, a broken
    ///      registry included.
    function renounceOwnership() public pure override {
        revert OwnershipNotRenounceable();
    }

    /// @dev `onlyOwner`, not `onlyTao`: a broken DID Registry must stay
    ///      replaceable. The TAO's key is checked against the new one instead,
    ///      so a wrong address cannot lock the TAO out.
    function setRegistries(address didRegistry_, address issuersRegistry_) external onlyOwner {
        _storeRegistries(didRegistry_, issuersRegistry_);
        if (!_controls(taoDid(), msg.sender)) revert NotDidController();
        emit RegistriesChanged(didRegistry_, issuersRegistry_);
    }

    function _storeRegistries(address didRegistry_, address issuersRegistry_) private {
        if (didRegistry_.code.length == 0 || issuersRegistry_.code.length == 0) revert InvalidRegistry();
        AccreditationStorage storage $ = _accreditationStorage();
        $.didRegistry = didRegistry_;
        $.issuersRegistry = issuersRegistry_;
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
    ///      `attribData` is not read.
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
        try IEbsiDidRegistry(didRegistry()).checkController(bytes(did), account) returns (bool ok) {
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
        try IEbsiIssuersRegistry(issuersRegistry()).getLatestRevisionAttribute(did, attributeId) returns (
            IEbsiIssuersRegistry.Attribute memory latest
        ) {
            return (true, latest);
        } catch {
            return (false, attribute);
        }
    }
}
