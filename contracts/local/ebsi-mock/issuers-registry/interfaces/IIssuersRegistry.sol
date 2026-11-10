// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../../did-registry/interfaces/IDidRegistry.sol";
import "../../policies-registry/interfaces/IPoliciesRegistry.sol";

/**
 * @title IIssuersRegistry
 * @notice External interface for the Issuers Registry, which manages issuers, their
 *         attributes (with full revision history), the trust chain between RootTAO/TAO/TI entities,
 *         and per-issuer proxy records (e.g. status lists).
 * @dev Authorization is enforced via the Policies Registry policies and DID-controller
 *      checks against the DID Registry. Reference structs/enums used across the ABI are declared here.
 */
interface IIssuersRegistry {
    // ============ Errors ============

    /// @notice A zero address was supplied where a contract address is required.
    error ZeroAddress();

    /// @notice The supplied issuer type is `Undefined`, or a new attribute was created as `Revoked`.
    error InvalidIssuerType();

    /// @notice Further revisions are not allowed: the attribute's latest
    ///         revision is already `Revoked`. Re-accreditation requires a new attribute.
    error AttributeAlreadyRevoked();

    /// @notice The supplied DID is empty.
    error InvalidDid();

    /// @notice The requested issuer has no attributes, i.e. it is not registered.
    error IssuerDoesNotExist();

    /// @notice The caller is not the controller of the issuer DID.
    error NotTheIssuerItself();

    /// @notice The attribute revision hash is already registered to another DID.
    error AttributeAlreadyStored();

    /// @notice No attribute matches the given DID and revision hash.
    error AttributeNotFound();

    /// @notice The computed revision id already exists.
    error RevisionAlreadyStored();

    /// @notice No revision matches the given DID and revision id.
    error RevisionNotFound();

    /// @notice The proxy payload is already registered for this issuer.
    error ProxyAlreadyStored();

    /// @notice No proxy record matches the given proxy id.
    error ProxyNotFound();

    /// @notice The proxy id is unknown or refers to an already removed record.
    error ProxyIdUnknownOrOld();

    /// @notice The proxy payload is empty.
    error InvalidProxyData();

    /// @notice The requested page size exceeds the maximum of 50.
    error PageSizeTooLarge();

    /// @notice The requested page size is zero.
    error PageSizeZero();

    /// @notice The requested page number is zero.
    error PageZero();

    /// @notice The sender neither controls the DID nor holds the required attribute.
    /// @param did The issuer DID being modified.
    /// @param attribute The policy attribute the sender is missing.
    error PolicyNotControllerOfDid(string did, string attribute);

    /// @notice The sender does not hold the required policy attribute.
    /// @param attribute The policy attribute the sender is missing.
    error PolicyAttributeMissing(string attribute);

    /// @notice The sender is neither a TAO/RootTAO nor holds the required attribute.
    /// @param attribute The policy attribute the sender is missing.
    error PolicyNotTaoOrRootTao(string attribute);

    /// @notice The sender is not a TAO/RootTAO of the current DID's trust chain
    ///         and does not hold the required attribute.
    /// @param did The issuer DID being modified.
    /// @param attribute The policy attribute the sender is missing.
    error PolicyNotTaoOrRootTaoOfDid(string did, string attribute);

    /// @notice The cited credential has no bounded, acyclic, live path to an
    ///         active RootTAO (revoked hop, missing parent, cycle, or depth cap).
    /// @param reason Which path check failed.
    error TrustChainBroken(string reason);

    /// @notice The cited credential's RootTAO differs from the attribute's
    ///         recorded RootTAO. Existing attributes cannot be re-anchored.
    /// @param taoDid The accreditor DID supplied by the caller.
    /// @param did The attribute owner DID.
    /// @param citedRootTaoDid The RootTAO of the cited accreditor credential.
    /// @param attributeRootTaoDid The RootTAO already recorded on the attribute.
    error PolicyRootTaoDiffers(string taoDid, string did, string citedRootTaoDid, string attributeRootTaoDid);

    // ============ Enums ============

    /**
     * @notice Role of an issuer within the trust hierarchy.
     * @dev `Undefined` is the zero value and is treated as invalid in setters.
     *      `Revoked` is terminal for an attribute chain: no further revisions
     *      (metadata or data) are accepted; re-accreditation requires a new attribute.
     */
    enum IssuerType {
        Undefined,
        RootTAO,
        TAO,
        TI,
        Revoked
    }

    // ============ Structs ============

    /**
     * @notice Per-revision metadata stored for each attribute version hash.
     * @param did The DID of the attribute owner.
     * @param attributeId The unique attribute ID (hash of the first attribute version).
     * @param issuerType The issuer type associated with this attribute. Zero value
     *        (`Undefined`) marks an unset slot; writers never persist `Undefined`.
     *        `Revoked` is terminal for the attribute chain.
     * @param taoDid Write-time snapshot of the accrediting TAO DID (not live-resolved).
     * @param rootTaoDid Write-time snapshot of the RootTAO DID at grant time (not
     *        live-resolved). Verifiers must walk `parentAttributeId` to a live RootTAO
     *        rather than treating this string as current authority.
     * @param parentAttributeId Canonical attribute id of the accrediting credential
     *        (`bytes32(0)` for RootTAO). Used to verify a live path to RootTAO.
     */
    struct AttributeMetadata {
        string did;
        bytes32 attributeId;
        IssuerType issuerType;
        string taoDid;
        string rootTaoDid;
        bytes32 parentAttributeId;
    }

    /**
     * @notice Full attribute view returned by read methods.
     * @param did The DID of the attribute owner.
     * @param attributeId The revision id of this returned version (not the
     *        canonical first-revision id). Callers that need the chain id should
     *        use the `attributeId` argument they queried with, or read
     *        `AttributeMetadata.attributeId` for that revision.
     * @param attribData The JSON-LD (or raw) attribute payload for this revision.
     * @param tao Write-time snapshot of the accrediting TAO DID.
     * @param rootTao Write-time snapshot of the RootTAO DID (historical; not live authority).
     * @param issuerType The issuer type associated with this attribute.
     * @param parentAttributeId Canonical attribute id of the accrediting credential
     *        (`bytes32(0)` for RootTAO).
     */
    struct Attribute {
        string did;
        bytes32 attributeId;
        bytes attribData;
        string tao;
        string rootTao;
        IssuerType issuerType;
        bytes32 parentAttributeId;
    }

    /**
     * @notice Per-entity (issuer) record holding its attributes, revisions and proxies.
     * @dev Contains mappings, so it is a storage-only type (not usable in external calldata/return).
     * @param attributes First-version hashes of each attribute owned by the entity.
     * @param revisions Revision hash => attribute payload.
     * @param revisionHashes First-attribute hash => ordered list of its revision hashes.
     * @param proxies List of proxy ids registered for the entity.
     * @param proxiesStore Proxy id => proxy payload.
     * @param noAttributesAccepted Whether the entity has yet to accept any attribute.
     * @param proxyIndex Proxy id => 1-based index into `proxies` (0 means absent).
     */
    struct Entity {
        bytes32[] attributes;
        mapping(bytes32 => bytes) revisions;
        mapping(bytes32 => bytes32[]) revisionHashes;
        bytes32[] proxies;
        mapping(bytes32 => string) proxiesStore;
        bool noAttributesAccepted;
        mapping(bytes32 => uint256) proxyIndex;
    }

    /**
     * @notice Top-level registry storage aggregate.
     * @dev Contains mappings, so it is a storage-only type (not usable in external calldata/return).
     * @param didStore List of all registered issuer DIDs.
     * @param issuerStore DID => {Entity}.
     * @param attributeMetadataStore Any attribute revision hash => {AttributeMetadata}.
     */
    struct Issuers {
        string[] didStore;
        mapping(string => Entity) issuerStore;
        mapping(bytes32 => AttributeMetadata) attributeMetadataStore;
    }

    // ============ Events ============

    /// @notice Emitted when a new attribute revision is added for an issuer.
    /// @param did The issuer DID.
    /// @param attributeId The canonical attribute id.
    /// @param revisionId The new revision id.
    /// @param issuerType The issuer type recorded on this revision.
    /// @param taoDid The accrediting TAO DID recorded on this revision.
    /// @param rootTaoDid The RootTAO DID recorded on this revision.
    /// @param author The `msg.sender` that authorised the revision.
    event AddAttributeRevision(
        string did,
        bytes32 indexed attributeId,
        bytes32 indexed revisionId,
        IssuerType issuerType,
        string taoDid,
        string rootTaoDid,
        address indexed author
    );

    /// @notice Emitted when an attribute transitions to `Revoked`.
    /// @dev Indexers may use this to invalidate descendant trust evaluations.
    ///      `taoDid` / `rootTaoDid` are the write-time snapshots recorded on the
    ///      revocation revision.
    /// @param did The issuer DID whose attribute was revoked.
    /// @param attributeId The canonical attribute id.
    /// @param taoDid The accrediting TAO DID snapshot on the revocation revision.
    /// @param rootTaoDid The RootTAO DID snapshot on the revocation revision.
    event AttributeRevoked(string did, bytes32 indexed attributeId, string taoDid, string rootTaoDid);

    /// @notice Emitted when a proxy record is added to an issuer.
    /// @param did The issuer DID.
    /// @param proxyId Content commitment `sha256(proxyData)`.
    event AddIssuerProxy(string did, bytes32 indexed proxyId);

    /// @notice Emitted when an issuer proxy payload is replaced.
    /// @dev Proxy ids are content commitments. The old id is removed and the
    ///      new payload is stored under `newProxyId == sha256(newProxyData)`.
    /// @param did The issuer DID.
    /// @param oldProxyId Previous content commitment (the id passed to update).
    /// @param newProxyId Content commitment of the replacement payload.
    event UpdateIssuerProxy(string did, bytes32 indexed oldProxyId, bytes32 indexed newProxyId);

    /// @notice Emitted when an issuer proxy record is removed.
    /// @param did The issuer DID.
    /// @param proxyId Content commitment that was removed.
    event RemoveIssuerProxy(string did, bytes32 indexed proxyId);

    // ============ Initialization ============

    /**
     * @notice Initializes the registry (proxy/beacon deployment).
     * @param _policiesRegistryAddress Address of the Policies Registry.
     * @param _didRegistryAddress Address of the DID Registry.
     */
    function initialize(address _policiesRegistryAddress, address _didRegistryAddress) external;

    // ============ Write methods ============

    /**
     * @notice Creates or appends attribute metadata for an issuer, enforcing trust-chain eligibility.
     * @dev For `RootTAO`, `taoDid` is forced to `did`. New issuers are registered on first call.
     *      Rejects empty `did` (and empty non-RootTAO `taoDid`) via `InvalidDid`.
     *      DID syntax/format is the DID Registry's concern.
     *      `Revoked` is terminal: an attribute whose latest revision is `Revoked`
     *      cannot receive further metadata or data revisions; re-accreditation
     *      requires a new attribute. Emits `AttributeRevoked` on transition to
     *      `Revoked`. Recorded `taoDid` / `rootTaoDid` are write-time snapshots.
     * @param did The issuer DID (must be non-empty).
     * @param revisionId For a new attribute, a client-chosen salt (the stored attribute id is
     *        derived as `sha256(abi.encode(did, salt, 0, ""))`); for an existing attribute, any
     *        of its revision hashes.
     * @param issuerType The issuer type (must not be `Undefined`; `Revoked` is terminal).
     * @param taoDid The accrediting TAO DID (must be non-empty unless `issuerType` is `RootTAO`).
     * @param attributeIdTao A revision hash of the TAO's accrediting attribute.
     */
    function setAttributeMetadata(
        string calldata did,
        bytes32 revisionId,
        IssuerType issuerType,
        string calldata taoDid,
        bytes32 attributeIdTao
    ) external;

    /**
     * @notice Stores a new data revision for an existing attribute. Caller must control `did`.
     * @dev Reverts `AttributeAlreadyRevoked` when the attribute's latest revision is
     *      `Revoked`. Re-accreditation requires a new attribute.
     * @param did The issuer DID.
     * @param attributeId The attribute id (any of its revision hashes).
     * @param attributeData The attribute payload; its sha256 becomes the new revision id.
     */
    function setAttributeData(string calldata did, bytes32 attributeId, bytes calldata attributeData) external;

    /**
     * @notice Adds a proxy record (e.g. status list) to an issuer.
     * @dev Caller must hold the `IssuersRegistry:updateIssuer` policy or control `did`.
     *      Rejects empty `proxyData`. Presence is tracked via `proxyIndex`.
     *      The proxy id is the content commitment `sha256(proxyData)`; verifiers
     *      must reject a resolved payload whose hash does not match the id.
     * @param did The issuer DID.
     * @param proxyData The proxy payload; its sha256 becomes the proxy id.
     */
    function addIssuerProxy(string calldata did, string calldata proxyData) external;

    /**
     * @notice Replaces a proxy payload, re-keying under the new content hash.
     * @dev Caller must hold the `IssuersRegistry:updateIssuer` policy or control `did`.
     *      Rejects empty `proxyData`. Removes `proxyId` and inserts the payload
     *      under `sha256(proxyData)`. If that hash already belongs to another
     *      of the issuer's proxies, reverts `ProxyAlreadyStored`. Verifiers
     *      must treat proxy ids as content commitments and follow
     *      `UpdateIssuerProxy` (old/new ids) when the status-list URL embeds an id.
     * @param did The issuer DID.
     * @param proxyId The existing content-commitment id to replace.
     * @param proxyData The new proxy payload (id becomes `sha256(proxyData)`).
     */
    function updateIssuerProxy(string calldata did, bytes32 proxyId, string calldata proxyData) external;

    /**
     * @notice Removes a proxy record from an issuer.
     * @dev Caller must hold the `IssuersRegistry:updateIssuer` policy or control `did`.
     *      Presence is tracked via `proxyIndex` (not payload length).
     * @param did The issuer DID.
     * @param proxyId The proxy id to remove.
     */
    function removeIssuerProxy(string calldata did, bytes32 proxyId) external;

    /**
     * @notice Rebuilds an issuer's proxy list, dropping empty-payload ghosts and
     *         duplicate ids left by pre-fix state.
     * @dev Caller must hold the `IssuersRegistry:updateIssuer` policy or control `did`.
     * @param did The issuer DID.
     */
    function compactIssuerProxies(string calldata did) external;

    // ============ Read methods ============

    /**
     * @notice Returns summary information for an issuer.
     * @param did The issuer DID.
     * @return noAttributesAccepted Whether the issuer has accepted any attribute.
     * @return totalAttributes The number of attributes (accepted or not).
     */
    function getIssuer(string memory did) external view returns (bool noAttributesAccepted, uint256 totalAttributes);

    /**
     * @notice Paginated list of all registered issuer DIDs.
     * @param page 1-based page number.
     * @param pageSize Page size (1..50).
     */
    function getIssuers(uint256 page, uint256 pageSize)
        external
        view
        returns (string[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Paginated list of an issuer's attribute ids.
     * @param did The issuer DID.
     * @param page 1-based page number.
     * @param pageSize Page size (1..50).
     */
    function getIssuerAttributes(string memory did, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Paginated list of revision hashes for a given attribute.
     * @param did The issuer DID.
     * @param anyAttrVersHash Any revision hash of the target attribute.
     * @param page 1-based page number.
     * @param pageSize Page size (1..50).
     */
    function getIssuerAttributeRevisions(string memory did, bytes32 anyAttrVersHash, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Returns the latest revision id for an issuer's attribute.
     * @param did The issuer DID.
     * @param attributeId The attribute id (any of its revision hashes).
     * @return latestRevisionAttributeId The most recent revision hash.
     */
    function getLatestRevisionAttributeId(string calldata did, bytes32 attributeId)
        external
        view
        returns (bytes32 latestRevisionAttributeId);

    /**
     * @notice Returns a specific attribute revision.
     * @dev Reverts `RevisionNotFound` when `revisionId` is unknown, belongs to
     *      another DID, or belongs to a different attribute chain than
     *      `attributeId`. The returned `Attribute.attributeId` is the revision
     *      id (`revisionId`), not the canonical first-revision id.
     * @param did The issuer DID.
     * @param attributeId Any revision hash of the attribute chain to select.
     * @param revisionId The specific revision id to fetch (must be on that chain).
     */
    function getRevisionAttribute(string calldata did, bytes32 attributeId, bytes32 revisionId)
        external
        view
        returns (Attribute memory attribute);

    /**
     * @notice Returns the latest revision of an issuer's attribute.
     * @param issuerDid The issuer DID.
     * @param attributeId The attribute id (any of its revision hashes).
     */
    function getLatestRevisionAttribute(string calldata issuerDid, bytes32 attributeId)
        external
        view
        returns (Attribute memory attribute);

    /**
     * @notice Returns the proxy payload for a given proxy id of an issuer.
     * @dev Presence is tracked via `proxyIndex` (0 means absent).
     * @param did The issuer DID.
     * @param proxyId The proxy id.
     */
    function getIssuerProxyById(string memory did, bytes32 proxyId) external view returns (string memory proxyData);

    /**
     * @notice Paginated list of an issuer's proxy ids.
     * @param did The issuer DID.
     * @param page 1-based page number.
     * @param pageSize Page size (1..50).
     */
    function getIssuerProxies(string memory did, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    // ============ Dependencies ============

    /// @notice The Policies Registry used for authorization checks.
    function policiesRegistryContract() external view returns (IPoliciesRegistry);

    /// @notice The DID Registry used for controller checks.
    function didRegistryContract() external view returns (IDidRegistry);
}
