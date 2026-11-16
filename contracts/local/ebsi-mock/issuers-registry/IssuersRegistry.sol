// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "../did-registry/interfaces/IDidRegistry.sol";
import "../policies-registry/interfaces/IPoliciesRegistry.sol";
import "./interfaces/IIssuersRegistry.sol";
import "./libraries/Pagination.sol";

/**
 * @title Issuers Registry Smart Contract
 */
contract IssuersRegistry is Initializable, ImplementationInitSelector, IIssuersRegistry {
    using Pagination for uint256;

    IPoliciesRegistry public policiesRegistryContract;
    IDidRegistry public didRegistryContract;

    Issuers internal issuers;

    /// @dev Maximum accreditation hops walked when verifying a live path to RootTAO.
    uint256 public constant MAX_TRUST_CHAIN_DEPTH = 32;

    /// @dev Policies Registry policy required to set attribute metadata (including RootTAO bootstrap).
    string internal constant POLICY_SET_ATTRIBUTE_METADATA = "IssuersRegistry:setAttributeMetadata";

    /// @dev Policies Registry policy that authorises issuer proxy maintenance as an alternative to DID control.
    string internal constant POLICY_UPDATE_ISSUER = "IssuersRegistry:updateIssuer";

    constructor() {
        _disableInitializers();
    }

    function initialize(address _policiesRegistryAddress, address _didRegistryAddress) external initializer {
        if (!(_policiesRegistryAddress != address(0) && _didRegistryAddress != address(0))) {
            revert ZeroAddress();
        }
        policiesRegistryContract = IPoliciesRegistry(_policiesRegistryAddress);
        didRegistryContract = IDidRegistry(_didRegistryAddress);
    }

    /**
     * @notice Returns the initializer selector for this implementation.
     */
    function getImplementationInitSelector() external pure override returns (bytes4) {
        return this.initialize.selector;
    }

    // external functions

    function setAttributeMetadata(
        string calldata did,
        bytes32 revisionId,
        IssuerType issuerType,
        string calldata taoDid,
        bytes32 attributeIdTao
    ) external {
        _requireValidDid(did);
        if (issuerType == IssuerType.Undefined) revert InvalidIssuerType();
        // RootTAO self-anchors; taoDid is unused for eligibility beyond that case.
        if (issuerType != IssuerType.RootTAO) {
            _requireValidDid(taoDid);
        }

        Entity storage iss = issuers.issuerStore[did];
        AttributeMetadata storage attrMetadata = issuers.attributeMetadataStore[revisionId];

        // insert the issuer if it doesn't exist
        if (iss.attributes.length == 0) {
            issuers.didStore.push(did);
            iss.noAttributesAccepted = true;
        }

        (bytes32 attributeId, bytes32 lastRevisionId, bytes32 newRevisionId, bool isNewAttribute) =
            _prepareAttributeRevision(did, revisionId, attrMetadata, iss);

        _setAttributeMetadata(
            did, attributeId, lastRevisionId, newRevisionId, isNewAttribute, issuerType, taoDid, attributeIdTao
        );
    }

    function _prepareAttributeRevision(
        string calldata did,
        bytes32 revisionId,
        AttributeMetadata storage attrMetadata,
        Entity storage iss
    ) internal returns (bytes32 attributeId, bytes32 lastRevisionId, bytes32 newRevisionId, bool isNewAttribute) {
        // Unset slots have issuerType == Undefined; writers never store Undefined.
        isNewAttribute = attrMetadata.issuerType == IssuerType.Undefined;
        if (isNewAttribute) {
            // `revisionId` is a client salt only — the storage key is namespaced
            // under `did` so it cannot collide with another party's keys.
            attributeId = _deriveRevisionId(did, revisionId, 0, "");
            if (issuers.attributeMetadataStore[attributeId].issuerType != IssuerType.Undefined) {
                revert RevisionAlreadyStored();
            }
            iss.attributes.push(attributeId);
            lastRevisionId = attributeId;
            newRevisionId = attributeId;
            return (attributeId, lastRevisionId, newRevisionId, isNewAttribute);
        }

        attributeId = attrMetadata.attributeId;
        if (!compareStrings(attrMetadata.did, did)) {
            revert AttributeAlreadyStored();
        }
        lastRevisionId = _getLatestRevisionAttributeId(did, revisionId);
        if (issuers.attributeMetadataStore[lastRevisionId].issuerType == IssuerType.Revoked) {
            revert AttributeAlreadyRevoked();
        }
        newRevisionId = _deriveRevisionId(did, attributeId, iss.revisionHashes[attributeId].length, "");
    }

    function _setAttributeMetadata(
        string calldata did,
        bytes32 attributeId,
        bytes32 lastRevisionId,
        bytes32 newRevisionId,
        bool isNewAttribute,
        IssuerType issuerType,
        string memory taoDid,
        bytes32 attributeIdTao
    ) internal {
        // An attribute cannot be created already revoked: revocation is a
        // transition on an existing grant. Allowing it permanently burns the
        // derived attribute id and removes the RootTAO recovery path.
        if (isNewAttribute && issuerType == IssuerType.Revoked) {
            revert InvalidIssuerType();
        }

        if (issuerType == IssuerType.RootTAO) {
            checkEligibility(did, lastRevisionId, issuerType, did, bytes32(0), POLICY_SET_ATTRIBUTE_METADATA);
            addRevision(did, attributeId, newRevisionId, issuerType, did, did, bytes32(0), "");
            return;
        }

        bytes32 lastRevisionIdTao = _getLatestRevisionAttributeId(taoDid, attributeIdTao);
        checkEligibility(did, lastRevisionId, issuerType, taoDid, lastRevisionIdTao, POLICY_SET_ATTRIBUTE_METADATA);

        AttributeMetadata storage taoMeta = issuers.attributeMetadataStore[lastRevisionIdTao];
        string memory rootTaoDid =
            isNewAttribute ? taoMeta.rootTaoDid : issuers.attributeMetadataStore[lastRevisionId].rootTaoDid;

        addRevision(did, attributeId, newRevisionId, issuerType, taoDid, rootTaoDid, taoMeta.attributeId, "");
    }

    function setAttributeData(string calldata did, bytes32 attributeId, bytes calldata attributeData) external {
        _requireValidDid(did);
        if (!checkController(bytes(did), msg.sender)) {
            revert NotTheIssuerItself();
        }
        issuers.issuerStore[did].noAttributesAccepted = false;

        bytes32 lastRevisionId = _getLatestRevisionAttributeId(did, attributeId);
        AttributeMetadata memory lastAttrMetadata = issuers.attributeMetadataStore[lastRevisionId];
        if (lastAttrMetadata.issuerType == IssuerType.Revoked) {
            revert AttributeAlreadyRevoked();
        }

        bytes32 canonicalAttributeId = lastAttrMetadata.attributeId;
        bytes32 newRevisionId = _deriveRevisionId(
            did,
            canonicalAttributeId,
            issuers.issuerStore[did].revisionHashes[canonicalAttributeId].length,
            attributeData
        );
        string memory taoDid = lastAttrMetadata.taoDid;
        string memory rootTaoDid = lastAttrMetadata.rootTaoDid;

        addRevision(
            did,
            canonicalAttributeId,
            newRevisionId,
            lastAttrMetadata.issuerType,
            taoDid,
            rootTaoDid,
            lastAttrMetadata.parentAttributeId,
            attributeData
        );
    }

    /**
     * @dev Add a proxy record to an issuer.
     *      Proxy id = sha256(proxyData) (content commitment).
     */
    function addIssuerProxy(string calldata did, string calldata proxyData) external {
        _requireValidDid(did);
        if (bytes(proxyData).length == 0) revert InvalidProxyData();
        if (issuers.issuerStore[did].attributes.length == 0) {
            revert IssuerDoesNotExist();
        }

        if (!_isAuthorizedIssuerOperator(did)) {
            revert PolicyNotControllerOfDid(did, POLICY_UPDATE_ISSUER);
        }

        bytes32 proxyId = sha256(bytes(proxyData));
        Entity storage iss = issuers.issuerStore[did];

        if (iss.proxyIndex[proxyId] != 0) {
            revert ProxyAlreadyStored();
        }
        iss.proxies.push(proxyId);
        iss.proxyIndex[proxyId] = iss.proxies.length;
        iss.proxiesStore[proxyId] = proxyData;
        emit AddIssuerProxy(did, proxyId);
    }

    /**
     * @dev Replace a proxy payload and re-key under sha256(new payload).
     */
    function updateIssuerProxy(string calldata did, bytes32 proxyId, string calldata proxyData) external {
        _requireValidDid(did);
        if (bytes(proxyData).length == 0) revert InvalidProxyData();
        if (!_isAuthorizedIssuerOperator(did)) {
            revert PolicyNotControllerOfDid(did, POLICY_UPDATE_ISSUER);
        }

        Entity storage iss = issuers.issuerStore[did];

        if (iss.proxyIndex[proxyId] == 0) revert ProxyNotFound();

        bytes32 newProxyId = sha256(bytes(proxyData));
        if (newProxyId == proxyId) {
            // Id already commits to this payload; refresh store and emit.
            iss.proxiesStore[proxyId] = proxyData;
            emit UpdateIssuerProxy(did, proxyId, newProxyId);
            return;
        }

        if (iss.proxyIndex[newProxyId] != 0) revert ProxyAlreadyStored();

        _removeProxyMembership(iss, proxyId);
        iss.proxies.push(newProxyId);
        iss.proxyIndex[newProxyId] = iss.proxies.length;
        iss.proxiesStore[newProxyId] = proxyData;

        emit UpdateIssuerProxy(did, proxyId, newProxyId);
    }

    /**
     * @dev Remove an issuer proxy.
     */
    function removeIssuerProxy(string calldata did, bytes32 proxyId) external {
        _requireValidDid(did);
        if (!_isAuthorizedIssuerOperator(did)) {
            revert PolicyNotControllerOfDid(did, POLICY_UPDATE_ISSUER);
        }

        Entity storage iss = issuers.issuerStore[did];

        if (iss.proxyIndex[proxyId] == 0) revert ProxyIdUnknownOrOld();

        _removeProxyMembership(iss, proxyId);

        emit RemoveIssuerProxy(did, proxyId);
    }

    /**
     * @dev Swap-remove a proxy id from membership and clear its payload.
     */
    function _removeProxyMembership(Entity storage iss, bytes32 proxyId) internal {
        uint256 index = iss.proxyIndex[proxyId];
        uint256 lastIndex = iss.proxies.length;
        bytes32 lastProxyId = iss.proxies[lastIndex - 1];
        iss.proxies[index - 1] = lastProxyId;
        iss.proxyIndex[lastProxyId] = index;
        iss.proxies.pop();
        iss.proxyIndex[proxyId] = 0;
        iss.proxiesStore[proxyId] = "";
    }

    /**
     * @dev Drop empty-payload ghosts and duplicate proxy ids for one issuer.
     */
    function compactIssuerProxies(string calldata did) external {
        _requireValidDid(did);
        if (issuers.issuerStore[did].attributes.length == 0) {
            revert IssuerDoesNotExist();
        }
        if (!_isAuthorizedIssuerOperator(did)) {
            revert PolicyNotControllerOfDid(did, POLICY_UPDATE_ISSUER);
        }

        Entity storage iss = issuers.issuerStore[did];
        uint256 length = iss.proxies.length;
        bytes32[] memory snapshot = new bytes32[](length);
        for (uint256 i = 0; i < length; i++) {
            bytes32 proxyId = iss.proxies[i];
            snapshot[i] = proxyId;
            iss.proxyIndex[proxyId] = 0;
        }
        while (iss.proxies.length > 0) {
            iss.proxies.pop();
        }
        for (uint256 i = 0; i < length; i++) {
            bytes32 proxyId = snapshot[i];
            if (iss.proxyIndex[proxyId] != 0) {
                continue; // duplicate id already kept
            }
            if (bytes(iss.proxiesStore[proxyId]).length == 0) {
                continue; // ghost: enumerated but unresolved
            }
            iss.proxies.push(proxyId);
            iss.proxyIndex[proxyId] = iss.proxies.length;
        }
    }

    /**
     * @dev Get an issuer by its DID.
     * @param did The DID of the issuer
     * @return noAttributesAccepted Whether the issuer has accepted any attribute or not
     * @return totalAttributes The number of attributes the issuer has (accepted or not)
     */
    function getIssuer(string memory did) external view returns (bool noAttributesAccepted, uint256 totalAttributes) {
        if (issuers.issuerStore[did].attributes.length == 0) {
            revert IssuerDoesNotExist();
        }
        noAttributesAccepted = issuers.issuerStore[did].noAttributesAccepted;
        totalAttributes = issuers.issuerStore[did].attributes.length;
    }

    function getIssuers(uint256 page, uint256 pageSize)
        external
        view
        returns (string[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = issuers.didStore.length.paginate(page, pageSize);
        items = new string[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = issuers.didStore[ids[i]];
        }
    }

    function getIssuerAttributes(string memory did, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        Pagination.requireValidParams(page, pageSize);
        uint256[] memory ids;
        if (issuers.issuerStore[did].attributes.length == 0) {
            revert IssuerDoesNotExist();
        }
        (ids, total, howMany, prev, next) = issuers.issuerStore[did].attributes.length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = issuers.issuerStore[did].attributes[ids[i]];
        }
    }

    function getIssuerAttributeRevisions(string memory did, bytes32 anyAttrVersHash, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        Pagination.requireValidParams(page, pageSize);
        // retrieve first the did and attrId (firstHash of attribute)
        AttributeMetadata storage am = issuers.attributeMetadataStore[anyAttrVersHash];
        if (issuers.issuerStore[did].attributes.length == 0) {
            revert IssuerDoesNotExist();
        }
        if (am.issuerType == IssuerType.Undefined || !compareStrings(am.did, did)) {
            revert AttributeNotFound();
        }

        bytes32[] storage revisionHashes = issuers.issuerStore[am.did].revisionHashes[am.attributeId];

        // retrieve the issuer and the attribute detail
        uint256[] memory ids;
        (ids, total, howMany, prev, next) =
            issuers.issuerStore[am.did].revisionHashes[am.attributeId].length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = revisionHashes[ids[i]];
        }
    }

    function getLatestRevisionAttributeId(string calldata did, bytes32 attributeId)
        public
        view
        returns (bytes32 latestRevisionAttributeId)
    {
        return _getLatestRevisionAttributeId(did, attributeId);
    }

    function getRevisionAttribute(string calldata did, bytes32 attributeId, bytes32 revisionId)
        public
        view
        returns (Attribute memory attribute)
    {
        Entity storage iss = issuers.issuerStore[did];
        if (iss.attributes.length == 0) revert IssuerDoesNotExist();

        AttributeMetadata storage attrMeta = issuers.attributeMetadataStore[attributeId];
        if (attrMeta.issuerType == IssuerType.Undefined || !compareStrings(attrMeta.did, did)) {
            revert AttributeNotFound();
        }

        // retrieve first the did and attrId (firstHash of attribute)
        AttributeMetadata storage i = issuers.attributeMetadataStore[revisionId];
        if (i.issuerType == IssuerType.Undefined || !compareStrings(i.did, did)) {
            revert RevisionNotFound();
        }
        // `attributeId` must select the same attribute chain as `revisionId`.
        if (i.attributeId != attrMeta.attributeId) {
            revert RevisionNotFound();
        }
        // retrieve the issuer and the attribute detail
        attribute.did = i.did;
        // Attribute.attributeId is the revision id of this version (not the
        // canonical first-revision id); see IIssuersRegistry NatSpec.
        attribute.attributeId = revisionId;
        attribute.attribData = iss.revisions[revisionId];
        attribute.tao = i.taoDid;
        attribute.rootTao = i.rootTaoDid;
        attribute.issuerType = i.issuerType;
        attribute.parentAttributeId = i.parentAttributeId;
    }

    function getLatestRevisionAttribute(string calldata issuerDid, bytes32 attributeId)
        external
        view
        returns (Attribute memory attribute)
    {
        bytes32 latestRevisionAttributeId = _getLatestRevisionAttributeId(issuerDid, attributeId);

        return getRevisionAttribute(issuerDid, attributeId, latestRevisionAttributeId);
    }

    /**
     * @dev Get proxy data by its id/hash.
     */
    function getIssuerProxyById(string memory did, bytes32 proxyId) external view returns (string memory proxyData) {
        Entity storage iss = issuers.issuerStore[did];
        if (iss.attributes.length == 0) revert IssuerDoesNotExist();
        if (iss.proxyIndex[proxyId] == 0) revert ProxyNotFound();
        return iss.proxiesStore[proxyId];
    }

    /**
     * @dev Return the list of proxies of a given issuer.
     */
    function getIssuerProxies(string memory did, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        Pagination.requireValidParams(page, pageSize);
        Entity storage iss = issuers.issuerStore[did];
        if (iss.attributes.length == 0) revert IssuerDoesNotExist();

        uint256[] memory ids;
        (ids, total, howMany, prev, next) = issuers.issuerStore[did].proxies.length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = issuers.issuerStore[did].proxies[ids[i]];
        }
    }

    // internal functions

    function addRevision(
        string memory did,
        bytes32 attributeId,
        bytes32 newRevisionId,
        IssuerType issuerType,
        string memory taoDid,
        string memory _rootTaoDid,
        bytes32 parentAttributeId,
        bytes memory attributeData
    ) internal {
        Entity storage iss = issuers.issuerStore[did];

        if (issuers.attributeMetadataStore[newRevisionId].issuerType != IssuerType.Undefined) {
            revert RevisionAlreadyStored();
        }

        // push the new version hash for this attribute
        iss.revisionHashes[attributeId].push(newRevisionId);
        // push the new version data for this attribute
        iss.revisions[newRevisionId] = attributeData;
        // push the new version metadata for this attribute
        issuers.attributeMetadataStore[newRevisionId] =
            AttributeMetadata(did, attributeId, issuerType, taoDid, _rootTaoDid, parentAttributeId);

        emit AddAttributeRevision(did, attributeId, newRevisionId, issuerType, taoDid, _rootTaoDid, msg.sender);

        if (issuerType == IssuerType.Revoked) {
            emit AttributeRevoked(did, attributeId, taoDid, _rootTaoDid);
        }
    }

    // internal view functions

    function checkEligibility(
        string memory did,
        bytes32 lastRevisionId,
        IssuerType issuerType,
        string memory taoDid,
        bytes32 lastRevisionIdTao,
        string memory policy
    ) internal view {
        bool hasPoliciesRegistryPolicy = _hasPolicy(policy);

        AttributeMetadata memory lastAttrMetadata = issuers.attributeMetadataStore[lastRevisionId];
        bool isNewAttribute = lastAttrMetadata.issuerType == IssuerType.Undefined;

        if (issuerType == IssuerType.RootTAO) {
            if (!hasPoliciesRegistryPolicy) {
                revert PolicyAttributeMissing(policy);
            }
            return;
        }

        AttributeMetadata memory lastTaoAttrMetadata = issuers.attributeMetadataStore[lastRevisionIdTao];

        // Existing attributes cannot be re-anchored under a different RootTAO,
        // including when the caller holds Policies Registry policy.
        if (!isNewAttribute && !compareStrings(lastTaoAttrMetadata.rootTaoDid, lastAttrMetadata.rootTaoDid)) {
            revert PolicyRootTaoDiffers(taoDid, did, lastTaoAttrMetadata.rootTaoDid, lastAttrMetadata.rootTaoDid);
        }

        if (hasPoliciesRegistryPolicy) return;

        // Non-Policies-Registry callers must control the cited accreditor DID and that
        // credential's latest revision must still be a live TAO or RootTAO.
        if (!(checkController(bytes(taoDid), msg.sender)
                    && (lastTaoAttrMetadata.issuerType == IssuerType.RootTAO
                        || lastTaoAttrMetadata.issuerType == IssuerType.TAO))) {
            revert PolicyNotTaoOrRootTao(policy);
        }

        // Require a live path from the cited credential to an active RootTAO so
        // that revoking an ancestor invalidates clones and cyclic re-grants.
        verifyLivePathToRootTao(lastRevisionIdTao);

        // in the case of existing attributes make sure the TAO/RootTAO
        // is part of the trust chain of the attribute
        bool isTaoOfAttribute = compareStrings(lastAttrMetadata.taoDid, taoDid);
        bool isRootTaoOfAttribute = compareStrings(lastAttrMetadata.rootTaoDid, taoDid);
        if (!(isNewAttribute || isTaoOfAttribute || isRootTaoOfAttribute)) {
            revert PolicyNotTaoOrRootTaoOfDid(did, policy);
        }
    }

    /**
     * @dev Walks parentAttributeId links from `latestRevisionId` to a RootTAO.
     *      Each hop must still be live (latest revision is RootTAO or TAO).
     *      Rejects cycles and chains longer than MAX_TRUST_CHAIN_DEPTH.
     */
    function verifyLivePathToRootTao(bytes32 latestRevisionId) internal view {
        bytes32 currentRevisionId = latestRevisionId;
        bytes32[MAX_TRUST_CHAIN_DEPTH] memory seenAttributeIds;
        AttributeMetadata memory meta;

        for (uint256 depth = 0; depth < MAX_TRUST_CHAIN_DEPTH; depth++) {
            meta = issuers.attributeMetadataStore[currentRevisionId];

            if (meta.issuerType == IssuerType.RootTAO) {
                return;
            }

            if (meta.issuerType != IssuerType.TAO) {
                revert TrustChainBroken("issuer type is not TAO");
            }

            if (meta.parentAttributeId == bytes32(0)) {
                revert TrustChainBroken("missing parent attribute");
            }

            for (uint256 i = 0; i < depth; i++) {
                if (seenAttributeIds[i] == meta.attributeId) {
                    revert TrustChainBroken("cycle detected");
                }
            }
            seenAttributeIds[depth] = meta.attributeId;

            AttributeMetadata memory parentMeta = issuers.attributeMetadataStore[meta.parentAttributeId];
            if (parentMeta.issuerType == IssuerType.Undefined) {
                revert TrustChainBroken("parent attribute not found");
            }

            currentRevisionId = _getLatestRevisionAttributeId(parentMeta.did, parentMeta.attributeId);
        }

        revert TrustChainBroken("max depth exceeded");
    }

    function _getLatestRevisionAttributeId(string memory did, bytes32 attributeId)
        internal
        view
        returns (bytes32 latestRevisionAttributeId)
    {
        Entity storage iss = issuers.issuerStore[did];
        if (iss.attributes.length == 0) revert IssuerDoesNotExist();
        AttributeMetadata storage meta = issuers.attributeMetadataStore[attributeId];
        if (meta.issuerType == IssuerType.Undefined || !compareStrings(meta.did, did)) {
            revert AttributeNotFound();
        }
        bytes32[] storage revisionHashes = iss.revisionHashes[meta.attributeId];
        if (revisionHashes.length == 0) revert AttributeNotFound();
        latestRevisionAttributeId = revisionHashes[revisionHashes.length - 1];
    }

    /**
     * @dev Reject the empty string so it cannot act as an existence sentinel or
     *      enter didStore. Syntax/format checks belong to the DID Registry.
     */
    function _requireValidDid(string memory did) internal pure {
        if (bytes(did).length == 0) revert InvalidDid();
    }

    /**
     * @dev Soft-read a Policies Registry policy. Inactive/undefined (and any other checkPolicy
     *      revert) normalise to false so controller fallbacks remain reachable.
     */
    function _hasPolicy(string memory policy) internal view returns (bool) {
        try getPoliciesRegistry().checkPolicy(policy, msg.sender) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /**
     * @dev Policies Registry `IssuersRegistry:updateIssuer` or DID controller of `did`. Both sides are
     *      soft so a reverting dependency cannot block the other branch.
     */
    function _isAuthorizedIssuerOperator(string memory did) internal view returns (bool) {
        return _hasPolicy(POLICY_UPDATE_ISSUER) || checkController(bytes(did), msg.sender);
    }

    function checkController(bytes memory identifier, address ctrl) internal view returns (bool) {
        // DidDoesNotExist (and other DID Registry failures) must not leak past
        // auth gates; treat as "not a controller" so local errors surface.
        try getDidRegistry().checkController(identifier, ctrl) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function getDidRegistry() internal view virtual returns (IDidRegistry) {
        return didRegistryContract;
    }

    function getPoliciesRegistry() internal view virtual returns (IPoliciesRegistry) {
        return policiesRegistryContract;
    }

    // pure functions

    /**
     * @dev Namespaced revision key: (did, attributeId, sequence, payload).
     *      Sequence is the current revision count for that attribute (0 for the
     *      first revision). Prevents global first-writer collisions across DIDs
     *      and allows republishing the same payload under a new sequence.
     */
    function _deriveRevisionId(string memory did, bytes32 attributeId, uint256 sequence, bytes memory attributeData)
        internal
        pure
        returns (bytes32)
    {
        return sha256(abi.encode(did, attributeId, sequence, attributeData));
    }

    function compareStrings(string memory str1, string memory str2) internal pure returns (bool) {
        return keccak256(abi.encodePacked(str1)) == keccak256(abi.encodePacked(str2));
    }

    uint256[50] private ______gap;
}
