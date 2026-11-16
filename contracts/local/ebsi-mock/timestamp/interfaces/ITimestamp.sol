// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title ITimestamp
 * @notice External API for the Timestamp service: hash algorithms, standalone timestamps, and versioned records.
 */
interface ITimestamp {
    // --- Errors ---
    /// @notice Thrown when a required address argument is the zero address.
    error ZeroAddress();
    /// @notice Thrown when the sender lacks the policy attribute required for the call.
    /// @param attribute The policy attribute that is missing.
    error PolicyAttributeMissing(string attribute);
    /// @notice Thrown when the requested page size is greater than 50.
    error PageSizeTooLarge();
    /// @notice Thrown when the requested page size is zero.
    error PageSizeZero();
    /// @notice Thrown when the requested page number is zero.
    error PageZero();
    /// @notice Thrown when the hash algorithm status is `undefined`.
    error StatusUndefined();
    /// @notice Thrown when the IANA name is empty.
    error IanaNameUnknown();
    /// @notice Thrown when the IANA name is already registered.
    error IanaNameDefined();
    /// @notice Thrown when the hash algorithm id does not exist.
    error HashAlgorithmIdUnknown();
    /// @notice Thrown when the referenced hash algorithm is not registered.
    error HashAlgoUnknown();
    /// @notice Thrown when the referenced hash algorithm is not active.
    error HashAlgoNotActive();
    /// @notice Thrown when more than three hash algorithm ids are supplied.
    error TooManyHashAlgorithmIds();
    /// @notice Thrown when more than three hash values are supplied.
    error TooManyHashValues();
    /// @notice Thrown when more than three timestamp data entries are supplied.
    error TooManyTimestampData();
    /// @notice Thrown when the hash value and hash algorithm id counts differ.
    error HashValueAlgoCountMismatch();
    /// @notice Thrown when timestampData has more elements than hashValues.
    error TimestampDataCountMismatch();
    /// @notice Thrown when an existing timestamp was created with a different hash algorithm.
    error TimestampWithDifferentHashAlgo();
    /// @notice Thrown when the supplied hash value is empty.
    error HashValueEmpty();
    /// @notice Thrown when the supplied hash value length does not match the hash algorithm's outputLength.
    error HashValueLengthMismatch();
    /// @notice Thrown when the supplied hash is empty.
    error HashEmpty();
    /// @notice Thrown when the supplied timestamp id is empty.
    error TimestampIdEmpty();
    /// @notice Thrown when the referenced timestamp does not exist.
    error TimestampUnknown();
    /// @notice Thrown when the referenced timestamp id does not exist.
    error TimestampIdUnknown();
    /// @notice Thrown when the timestamp id is not attached to the given record version.
    error TimestampNotInVersion();
    /// @notice Thrown when the supplied record id is empty.
    error RecordIdEmpty();
    /// @notice Thrown when the referenced record does not exist.
    error RecordUnknown();
    /// @notice Thrown when the record already exists.
    error RecordExists();
    /// @notice Thrown when the referenced record version does not exist.
    error RecordVersionUnknown();
    /// @notice Thrown when the supplied version hash is empty.
    error VersionHashEmpty();
    /// @notice Thrown when the supplied version info is empty.
    error VersionInfoEmpty();
    /// @notice Thrown when the supplied version info id is empty.
    error VersionInfoIdEmpty();
    /// @notice Thrown when the version hash does not resolve to exactly one record.
    error WrongRecordCount();
    /// @notice Thrown when the sender is not listed as an owner of the record.
    error SenderNotOwner();
    /// @notice Thrown when the maximum number of records per timestamp is reached.
    error RecordsPerTimestampLimitExceeded();
    /// @notice Thrown when the maximum number of first-version records per timestamp is reached.
    error RecordsPerTimestampLimitExceededInFirstVersion();
    /// @notice Thrown when the maximum number of timestamps per version is reached.
    error TimestampsPerVersionLimitExceeded();
    /// @notice Thrown when the maximum number of version info entries per version is reached.
    error VersionInfoPerVersionLimitExceeded();
    /// @notice Thrown when the supplied owner id is empty.
    error OwnerIdEmpty();
    /// @notice Thrown when the owner id is already registered on the record.
    error OwnerIdExists();
    /// @notice Thrown when the owner id is not registered on the record.
    error OwnerIdUnknown();
    /// @notice Thrown when revoking the owner would leave the record without any owner.
    error CannotRevokeLastOwner();
    /// @notice Thrown when the supplied validity window is invalid.
    error DateIncorrect();
    /// @notice Thrown when the supplied commitment is empty.
    error CommitmentEmpty();
    /// @notice Thrown when the sender already registered the same commitment.
    error CommitmentExists();
    /// @notice Thrown when the sender has no commitment matching the revealed arguments.
    error CommitmentUnknown();
    /// @notice Thrown when fewer than `TIMESTAMP_COMMITMENT_MATURITY` blocks elapsed since the commit.
    error CommitmentNotMatured();

    /// @notice Lifecycle state of a registered hash algorithm.
    enum Status {
        undefined,
        active,
        revoked
    }

    /// @notice Metadata for a registered hash algorithm.
    struct HashAlgoInfo {
        uint256 outputLength;
        string ianaName;
        string oid;
        Status status;
        string multiHash;
    }

    /// @notice Hash value paired with its registered algorithm id.
    struct Hash {
        uint256 algorithm;
        bytes value;
    }

    /// @notice Storage layout for registered hash algorithms.
    struct HashAlgos {
        mapping(uint256 => HashAlgoInfo) hashAlgorithms;
        mapping(string => bool) ianaNameDefined;
        uint256 numberOfAlgorithms;
    }

    /// @notice Stored timestamp entry for a hash value.
    struct Timestamp {
        Hash hash;
        address timestampedBy;
        uint64 commitBlockNumber;
        uint256 blockNumber;
        bytes data;
    }

    /// @notice Storage layout for standalone timestamps.
    struct Timestamps {
        uint256 version;
        mapping(bytes32 => Timestamp) timestampsStore;
        bytes32[] timestampIdsList;
        /// @dev committer => commitment => block number in which the commitment was registered.
        mapping(address => mapping(bytes32 => uint64)) commitments;
    }

    /// @notice Validity window and revocation state for a record owner.
    struct OwnerInfo {
        uint256 notBefore;
        uint256 notAfter;
        bool revoked;
    }

    /// @notice Index metadata for a revoked record owner.
    struct RevokedOwner {
        bool exists;
        uint256 index;
    }

    /// @notice Hashes and metadata attached to a single record version.
    struct VersionDetails {
        bytes32[] timestampsIds;
        bytes32[] info;
        mapping(bytes32 => bool) timestampExist;
    }

    /// @notice Storage layout for a single record and its versions.
    struct Record {
        string[] owners;
        mapping(string => uint256) ownerIndex;
        string[] revokedOwnerIds;
        mapping(string => RevokedOwner) revokedOwnerIndex;
        mapping(string => OwnerInfo) ownerInfo;
        mapping(string => uint256) revokedOwnerIdsToBlockNum;
        mapping(bytes32 => uint256) timestampIdToVersionId;
        mapping(bytes32 => uint256) timestampVersionCount;
        uint256 totalVersions;
        mapping(uint256 => VersionDetails) versionsStore;
    }

    /// @notice Top-level storage layout for all records.
    struct Records {
        mapping(bytes32 => Record) recordsStore;
        mapping(bytes32 => bytes) versionInfoStore;
        bytes32[] recordIdsList;
        mapping(bytes32 => bytes32[]) timestampIdToRecordIds;
        mapping(string => bytes32[]) ownerIdToRecordIds;
        mapping(string => mapping(bytes32 => uint256)) indexOwnerIdToRecordIds;
        mapping(bytes32 => bytes32[]) firstVersionTimestampToRecordIds;
        mapping(bytes32 => mapping(bytes32 => bool)) checkTimestampIdToRecordIdExist;
    }

    /// @notice Emitted when a new hash algorithm is registered.
    event AddNewHashAlgo(
        uint256 indexed hashId,
        string indexed ianaNameHash,
        uint256 outputLength,
        string oid,
        Status status,
        string multiHash
    );

    /// @notice Emitted when an existing hash algorithm is updated.
    event UpdateHashAlgo(
        uint256 indexed hashId,
        string indexed ianaNameHash,
        string ianaName,
        uint256 outputLength,
        string oid,
        Status status,
        string multiHash
    );

    /// @notice Emitted when hashes are timestamped into a new record.
    event RecordedHashes(bytes32 indexed recordId, bytes32[] timestampIds, bytes32 versionInfoHash);

    /// @notice Emitted when version info is stored for a record version.
    event RecordVersionInfo(bytes32 indexed recordId, bytes32 versionInfoHash, uint256 versionId);

    /// @notice Emitted when a timestamp id is detached from a record version.
    event TimestampIdDetached(bytes32 timestampId);

    /// @notice Emitted when an owner is added to a record.
    event RecordOwnerAdded(string ownerId);

    /// @notice Emitted when a record owner is revoked.
    event OwnerIdRevoked(string ownerId);

    /// @notice Emitted when version hashes are timestamped without creating a record.
    event TimestampVersionHashes(bytes versionHash, bytes32[] timestampIds, bytes versionInfo);

    /// @notice Emitted when a commitment for a future timestamp reveal is registered.
    event TimestampHashesCommitted(address indexed committedBy, bytes32 indexed commitment, uint64 blockNumber);

    /// @notice Emitted when one or more hashes are timestamped.
    /// @dev `commitBlockNumber` is the block of the commitment the sender revealed. It covers
    /// every hash in the event, since a single commitment binds the whole reveal, and it is
    /// carried here so that consumers do not have to query the contract for it afterwards.
    event TimestampedHashes(
        bytes32[] timestampIds,
        uint256[] hashAlgorithmIds,
        bytes[] hashValues,
        bytes[] timestampData,
        uint64 commitBlockNumber
    );

    /**
     * @notice Registers a new hash algorithm.
     * @param outputLength Expected output length of the algorithm in bits.
     * @param ianaName IANA-registered name of the algorithm.
     * @param oid Object identifier of the algorithm.
     * @param status Initial lifecycle status.
     * @param multiHash Multihash representation of the algorithm.
     */
    function insertHashAlgorithm(
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        Status status,
        string memory multiHash
    ) external;

    /**
     * @notice Updates an existing hash algorithm.
     * @param hashAlgorithmId Id of the algorithm to update.
     * @param outputLength Updated output length in bits.
     * @param ianaName Updated IANA name.
     * @param oid Updated object identifier.
     * @param status Updated lifecycle status.
     * @param multiHash Updated multihash representation.
     */
    function updateHashAlgorithm(
        uint256 hashAlgorithmId,
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        Status status,
        string memory multiHash
    ) external;

    /**
     * @notice Returns hash algorithm details by id.
     * @param hashAlgorithmId Id of the algorithm to query.
     * @return outputLength Expected output length in bits.
     * @return ianaName IANA-registered name.
     * @return oid Object identifier.
     * @return status Current lifecycle status.
     * @return multiHash Multihash representation.
     */
    function getHashAlgorithmById(uint256 hashAlgorithmId)
        external
        view
        returns (
            uint256 outputLength,
            string memory ianaName,
            string memory oid,
            Status status,
            string memory multiHash
        );

    /**
     * @notice Returns a paginated list of registered hash algorithm ids.
     * @param page One-based page number.
     * @param pageSize Number of items per page.
     * @return items Hash algorithm ids for the requested page.
     * @return total Total number of registered algorithms.
     * @return howMany Number of items returned in `items`.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getHashAlgorithms(uint256 page, uint256 pageSize)
        external
        view
        returns (uint256[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Registers a commitment for a later timestamp reveal.
     * @dev Every function that creates timestamps requires a commitment registered by the same
     *      sender at least `TIMESTAMP_COMMITMENT_MATURITY` blocks earlier.
     * @param commitment Value returned by {computeTimestampCommitment} for the intended reveal.
     */
    function commitTimestampHashes(bytes32 commitment) external;

    /**
     * @notice Computes the commitment for a timestamp reveal.
     * @param committedBy Address that will send both the commit and the reveal transaction.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param salt Secret value known only to the committer until the reveal.
     * @return commitment Commitment to register with {commitTimestampHashes}.
     */
    function computeTimestampCommitment(
        address committedBy,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes32 salt
    ) external view returns (bytes32 commitment);

    /**
     * @notice Returns the block in which a commitment was registered.
     * @param committedBy Address that registered the commitment.
     * @param commitment Commitment to query.
     * @return blockNumber Block number of the commit transaction, or zero if unknown.
     */
    function getTimestampCommitmentBlock(address committedBy, bytes32 commitment)
        external
        view
        returns (uint64 blockNumber);

    /**
     * @notice Returns the commit block of the commitment `timestampedBy` revealed.
     * @param timestampId Id of the timestamp to query.
     * @return commitBlockNumber Commit block of the reveal that created the timestamp, or zero
     *         if unknown.
     */
    function getTimestampCommitBlock(bytes32 timestampId) external view returns (uint64 commitBlockNumber);

    /**
     * @notice Timestamps one or more hashes. Up to three hashes can be timestamped at a time.
     * @dev Reveals a commitment previously registered with {commitTimestampHashes} at least
     *      `TIMESTAMP_COMMITMENT_MATURITY` blocks earlier.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param salt Secret value used to build the commitment.
     * @return timestampIds Computed ids for the stored timestamps.
     */
    function timestampHashes(
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes32 salt
    ) external returns (bytes32[] memory timestampIds);

    /**
     * @notice Returns a paginated list of timestamp ids.
     * @param page One-based page number.
     * @param pageSize Number of items per page.
     * @return items Timestamp ids for the requested page.
     * @return total Total number of stored timestamps.
     * @return howMany Number of items returned in `items`.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getTimestamps(uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Returns the timestamp stored for a hash value.
     * @param hashValue Raw hash value used to derive the timestamp id.
     * @return hash Stored hash and algorithm id.
     * @return timestampedBy Address that created the timestamp.
     * @return blockNumber Block number when the timestamp was created.
     * @return data Optional metadata attached to the timestamp.
     */
    function getTimestamp(bytes calldata hashValue)
        external
        view
        returns (Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data);

    /**
     * @notice Returns a timestamp by its id (`sha256(hashValue)`).
     * @param timestampId Id of the timestamp to query.
     * @return hash Stored hash and algorithm id.
     * @return timestampedBy Address that created the timestamp.
     * @return blockNumber Block number when the timestamp was created.
     * @return data Optional metadata attached to the timestamp.
     */
    function getTimestampById(bytes32 timestampId)
        external
        view
        returns (Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data);

    /**
     * @notice Timestamps up to three version hashes and stores them under a version hash without creating a record.
     * @param versionHash Identifier for the version being timestamped.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param versionInfo Opaque version metadata to store alongside the timestamps.
     * @param salt Secret value used to build the commitment.
     */
    function timestampVersionHashes(
        bytes calldata versionHash,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external;

    /**
     * @notice Timestamps up to three record hashes and collects them in a new record.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param versionInfo Opaque version metadata for the first record version.
     * @param salt Secret value used to build the commitment.
     * @return recordId Id of the newly created record.
     */
    function timestampRecordHashes(
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external returns (bytes32 recordId);

    /**
     * @notice Timestamps up to three version hashes and appends them as a new version on an existing record.
     * @param recordId Id of the target record.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param versionInfo Opaque version metadata for the new version.
     * @param salt Secret value used to build the commitment.
     */
    function timestampRecordVersionHashes(
        bytes32 recordId,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external;

    /**
     * @notice Timestamps additional hashes and appends them to an existing record version.
     * @param recordId Id of the target record.
     * @param versionId Version to extend.
     * @param hashAlgorithmIds Registered algorithm id for each hash.
     * @param hashValues Raw hash values to timestamp.
     * @param timestampData Optional metadata for each hash.
     * @param versionInfo Opaque version metadata to append.
     * @param salt Secret value used to build the commitment.
     */
    function appendRecordVersionHashes(
        bytes32 recordId,
        uint256 versionId,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external;

    /**
     * @notice Inserts additional version info for an existing record version.
     * @param recordId Id of the target record.
     * @param versionId Version to update.
     * @param versionInfo Opaque version metadata to store.
     */
    function insertRecordVersionInfo(bytes32 recordId, uint256 versionId, bytes calldata versionInfo) external;

    /**
     * @notice Detaches a timestamp id from a record version.
     * @param recordId Id of the target record.
     * @param versionId Version to update.
     * @param hashValue Raw hash value whose timestamp id should be detached.
     */
    function detachRecordVersionHash(bytes32 recordId, uint256 versionId, bytes calldata hashValue) external;

    /**
     * @notice Adds an owner to a record.
     * @param recordId Id of the target record.
     * @param ownerId DID or address identifying the owner.
     * @param notBefore Unix timestamp before which the owner is inactive.
     * @param notAfter Unix timestamp after which the owner is inactive.
     */
    function insertRecordOwner(bytes32 recordId, string calldata ownerId, uint256 notBefore, uint256 notAfter) external;

    /**
     * @notice Revokes an existing record owner.
     * @param recordId Id of the target record.
     * @param ownerId DID or address of the owner to revoke.
     */
    function revokeRecordOwner(bytes32 recordId, string calldata ownerId) external;

    /**
     * @notice Returns validity and revocation info for a record owner.
     * @param recordId Id of the target record.
     * @param ownerId DID or address of the owner to query.
     * @return revoked Whether the owner has been revoked.
     * @return notBefore Unix timestamp before which the owner is inactive.
     * @return notAfter Unix timestamp after which the owner is inactive.
     */
    function getRecordOwnerInfo(bytes32 recordId, string calldata ownerId)
        external
        view
        returns (bool revoked, uint256 notBefore, uint256 notAfter);

    /**
     * @notice Returns a paginated list of record ids owned by `ownerId`.
     * @param ownerId DID or address of the owner.
     * @param page One-based page number.
     * @param pageSize Number of items per page.
     * @return items Record ids for the requested page.
     * @return total Total number of records for the owner.
     * @return howMany Number of items returned in `items`.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getRecordIdsByOwnerId(string calldata ownerId, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Returns a paginated list of all record ids.
     * @param page One-based page number.
     * @param pageSize Number of items per page.
     * @return items Record ids for the requested page.
     * @return total Total number of records.
     * @return howMany Number of items returned in `items`.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getRecordIds(uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Returns record ids whose first version contains the given hash.
     * @param hashValue Raw hash value from the first record version.
     * @param page One-based page number.
     * @param pageSize Number of items per page.
     * @return items Matching record ids for the requested page.
     * @return total Total number of matching records.
     * @return howMany Number of items returned in `items`.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getRecordIdsByFirstVersionHash(bytes calldata hashValue, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    /**
     * @notice Returns owner lists and version count for a record.
     * @param recordId Id of the record to query.
     * @return ownerIds Active owner ids.
     * @return revokedOwnerIds Revoked owner ids.
     * @return totalVersions Number of versions stored for the record.
     */
    function getRecord(bytes32 recordId)
        external
        view
        returns (string[] memory ownerIds, string[] memory revokedOwnerIds, uint256 totalVersions);

    /**
     * @notice Returns hashes and version info ids for a record version.
     * @param recordId Id of the record to query.
     * @param versionId Version number to query.
     * @param page One-based page number for timestamp ids within the version.
     * @param pageSize Number of timestamp ids per page.
     * @return hashAlgorithmIds Algorithm id for each timestamp in the page.
     * @return hashValues Hash value for each timestamp in the page.
     * @return infoIds Stored version info hashes for the version.
     * @return total Total number of timestamp ids in the version.
     * @return howMany Number of timestamp ids returned in the hash arrays.
     * @return prev Previous page number, or zero if none.
     * @return next Next page number, or zero if none.
     */
    function getRecordVersion(bytes32 recordId, uint256 versionId, uint256 page, uint256 pageSize)
        external
        view
        returns (
            uint256[] memory hashAlgorithmIds,
            bytes[] memory hashValues,
            bytes32[] memory infoIds,
            uint256 total,
            uint256 howMany,
            uint256 prev,
            uint256 next
        );

    /**
     * @notice Returns opaque version info by its content hash.
     * @param versionInfoId Hash id of the stored version info.
     * @return info Stored version metadata.
     */
    function getRecordVersionInfo(bytes32 versionInfoId) external view returns (bytes memory info);
}
