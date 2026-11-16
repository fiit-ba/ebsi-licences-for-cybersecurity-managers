// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "../bootstrap/utils/Pagination.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "./interfaces/IDidDocument.sol";
import "./interfaces/IControllers.sol";
import "./interfaces/IVRelationships.sol";
import "../policies-registry/interfaces/IPoliciesRegistry.sol";
import "./library/DidDocumentLib.sol";
import "./library/ControllersLib.sol";
import "./library/VRelationshipsLib.sol";

contract DidRegistry is Initializable, ImplementationInitSelector, IDidDocument, IControllers, IVRelationships {
    using DidDocumentLib for DidDocuments;
    using ControllersLib for Controllers;
    using VRelationshipsLib for VRelationships;
    using Pagination for uint256;

    IPoliciesRegistry public policiesRegistryContract;

    DidDocuments internal didDocuments;
    Controllers internal controllers;
    VRelationships internal vRelationships;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _policiesRegistryAddress) external initializer {
        if (_policiesRegistryAddress == address(0)) revert ZeroAddress();
        policiesRegistryContract = IPoliciesRegistry(_policiesRegistryAddress);
    }

    /**
     * @notice Returns the initializer selector for this implementation.
     */
    function getImplementationInitSelector() external pure override returns (bytes4) {
        return this.initialize.selector;
    }

    function insertDidDocument(
        string memory did,
        string memory baseDocument,
        string memory vMethodId,
        bytes memory publicKey,
        bool isSecp256k1,
        uint256 notBefore,
        uint256 notAfter
    ) external returns (bool) {
        if (!isSecp256k1) revert FirstPublicKeyMustBeSecp256k1();
        bool result = didDocuments.insertDidDocument(
            vRelationships, did, baseDocument, vMethodId, publicKey, isSecp256k1, notBefore, notAfter
        );
        controllers.linkDidToController(did, did);
        emit DidDocumentInserted(did, baseDocument, vMethodId, publicKey, isSecp256k1, notBefore, notAfter);
        return result;
    }

    function updateBaseDocument(string memory did, string memory baseDocument) external returns (bool) {
        onlyControllerOrAuth(did, "DidRegistry:updateBaseDocument");
        bool result = didDocuments.updateBaseDocument(did, baseDocument);
        emit BaseDocumentUpdated(did, baseDocument);
        return result;
    }

    function addController(string memory did, string memory controller) external returns (bool) {
        onlyControllerOrAuth(did, "DidRegistry:addController");
        bool result = didDocuments.addController(did, controller);
        controllers.linkDidToController(did, controller);
        emit ControllerAdded(did, controller);
        return result;
    }

    function revokeController(string memory did, string memory controller) external returns (bool) {
        onlyControllerOrAuth(did, "DidRegistry:revokeController");
        bool result = didDocuments.revokeController(did, controller);
        controllers.unlinkDidFromController(did, controller);
        emit ControllerRevoked(did, controller);
        return result;
    }

    function addVerificationMethod(string memory did, string memory vMethodId, bytes memory publicKey, bool isSecp256k1)
        external
        returns (bool)
    {
        onlyControllerOrAuth(did, "DidRegistry:addVerificationMethod");
        bool result = didDocuments.addVerificationMethod(did, vMethodId, publicKey, isSecp256k1);
        emit VerificationMethodAdded(did, vMethodId, publicKey, isSecp256k1);
        return result;
    }

    function addVerificationRelationship(
        string memory did,
        string memory name,
        string memory vMethodId,
        uint256 notBefore,
        uint256 notAfter
    ) external returns (bool) {
        onlyControllerOrAuth(did, "DidRegistry:addVerificationRelationship");
        bool result =
            didDocuments.addVerificationRelationship(vRelationships, did, name, vMethodId, notBefore, notAfter);
        emit VerificationRelationshipAdded(did, name, vMethodId, notBefore, notAfter);
        return result;
    }

    function revokeVerificationMethod(string memory did, string memory vMethodId, uint256 notAfter)
        external
        returns (bool)
    {
        onlyControllerOrAuth(did, "DidRegistry:revokeVerificationMethod");
        bool result = didDocuments.revokeVerificationMethod(vRelationships, did, vMethodId, notAfter);
        emit VerificationMethodRevoked(did, vMethodId, notAfter);
        return result;
    }

    function expireVerificationMethod(string memory did, string memory vMethodId, uint256 notAfter)
        external
        returns (bool)
    {
        onlyControllerOrAuth(did, "DidRegistry:expireVerificationMethod");
        bool result = didDocuments.expireVerificationMethod(vRelationships, did, vMethodId, notAfter);
        emit VerificationMethodExpired(did, vMethodId, notAfter);
        return result;
    }

    function rollVerificationMethod(RollArgs memory args) external returns (bool) {
        onlyControllerOrAuth(args.did, "DidRegistry:rollVerificationMethod");

        didDocuments.rollVerificationMethod(vRelationships, args);
        emit VerificationMethodRolled(
            args.did,
            args.vMethodId,
            args.publicKey,
            args.isSecp256k1,
            args.notBefore,
            args.notAfter,
            args.oldVMethodId,
            args.duration
        );
        return true;
    }

    function getDids(uint256 page, uint256 pageSize)
        external
        view
        returns (string[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = didDocuments.dids.length.paginate(page, pageSize);
        items = new string[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = didDocuments.dids[ids[i]];
        }
    }

    function getDidsByController(string memory controller, uint256 page, uint256 pageSize)
        external
        view
        returns (string[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        if (bytes(didDocuments.didList[controller].baseDocument).length == 0) {
            revert ControllerDoesNotExist();
        }
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = controllers.didsByController[controller].length.paginate(page, pageSize);
        items = new string[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = controllers.didsByController[controller][ids[i]];
        }
    }

    function getDidsByVerificationRelationship(
        string memory vMethodId,
        string memory name,
        uint256 page,
        uint256 pageSize
    ) external view returns (DidWithPeriod[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next) {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        uint256 vrId = uint256(keccak256(abi.encodePacked(name, vMethodId)));

        uint256[] memory ids;
        (ids, total, howMany, prev, next) = vRelationships.didsByVRelationship[vrId].length.paginate(page, pageSize);
        items = new DidWithPeriod[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = vRelationships.didsByVRelationship[vrId][ids[i]];
        }
    }

    function getDidDocument(string memory did)
        external
        view
        returns (
            string memory baseDocument,
            string[] memory controllerList,
            string[] memory vMethodIds,
            VMethod[] memory vMethods,
            VRelationship[] memory vRelationshipList
        )
    {
        return didDocuments.getDidDocumentByTimestamp(did, block.timestamp);
    }

    function getDidDocumentByTimestamp(string memory did, uint256 timestamp)
        external
        view
        returns (
            string memory baseDocument,
            string[] memory controllerList,
            string[] memory vMethodIds,
            VMethod[] memory vMethods,
            VRelationship[] memory vRelationshipList
        )
    {
        return didDocuments.getDidDocumentByTimestamp(did, timestamp);
    }

    function checkController(string memory did, address controller) external view returns (bool) {
        return _checkController(did, controller);
    }

    function checkController(bytes memory did, address controller) external view returns (bool) {
        return _checkController(string(did), controller);
    }

    // internal

    function _checkController(string memory did, address controller) internal view returns (bool) {
        DidDocument storage d = didDocuments.didList[did];

        // check did exist
        if (bytes(d.baseDocument).length == 0) revert DidDoesNotExist();

        // check all controllers
        for (uint256 i = 0; i < d.controllers.length; i++) {
            // get DID Document of the controller
            DidDocument storage docController = didDocuments.didList[d.controllers[i]];

            // check all capabilityInvocations
            string memory vMethodId = docController.vMethodIdOfAddress[controller];

            if (bytes(vMethodId).length > 0) {
                if (docController.capabilityInvocationMethodIdExist[vMethodId]) {
                    VRelationship memory vRelationship;
                    vRelationship =
                        docController.capabilityInvocations[docController.capabilityInvocationMethodIdIndex[vMethodId]];
                    // Inclusive bounds — must match getDidDocumentByTimestamp.
                    if (block.timestamp >= vRelationship.notBefore && block.timestamp <= vRelationship.notAfter) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function onlyControllerOrAuth(string memory did, string memory policiesRegistryAttribute) internal view {
        DidDocument storage d = didDocuments.didList[did];

        // check did exist
        if (bytes(d.baseDocument).length == 0) revert DidDoesNotExist();

        bool isController = _checkController(did, msg.sender);

        if (isController) {
            return;
        } else {
            bool isAuthorized = getPoliciesRegistry().checkPolicy(policiesRegistryAttribute, msg.sender);
            if (!isAuthorized) {
                revert NotControllerNorAuthorisedForPolicy(policiesRegistryAttribute);
            }
            return;
        }
    }

    function getPoliciesRegistry() internal view returns (IPoliciesRegistry) {
        return policiesRegistryContract;
    }

    uint256[50] private __gap;
}
