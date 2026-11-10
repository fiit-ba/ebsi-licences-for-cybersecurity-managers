// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "../bootstrap/utils/Pagination.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "../policies-registry/interfaces/IPoliciesRegistry.sol";
import "./interfaces/ITimestamp.sol";
import "./libraries/HashAlgoLib.sol";
import "./libraries/RecordLib.sol";
import "./libraries/TimestampLib.sol";

/**
 * @title Timestamp
 * @notice Upgradeable implementation of {ITimestamp} for hash algorithms, timestamps, and versioned records.
 */
contract Timestamp is ITimestamp, Initializable, ImplementationInitSelector {
    using HashAlgoLib for HashAlgos;
    using RecordLib for Records;
    using TimestampLib for Timestamps;
    using Pagination for uint256;

    /// @dev Blocks that must elapse after a commit before a reveal may timestamp its hashes.
    uint64 public constant TIMESTAMP_COMMITMENT_MATURITY = TimestampLib.TIMESTAMP_COMMITMENT_MATURITY;

    IPoliciesRegistry public policiesRegistryContract;

    HashAlgos internal hashAlgos;
    Timestamps internal timestamps;
    Records internal records;

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

    /// @inheritdoc ITimestamp
    function insertHashAlgorithm(
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        Status status,
        string memory multiHash
    ) external {
        if (!policiesRegistryContract.checkPolicy("Timestamp:insertHashAlgorithm", msg.sender)) {
            revert PolicyAttributeMissing("Timestamp:insertHashAlgorithm");
        }
        hashAlgos.insertHashAlgorithm(outputLength, ianaName, oid, status, multiHash);
    }

    /// @inheritdoc ITimestamp
    function updateHashAlgorithm(
        uint256 hashAlgorithmId,
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        Status status,
        string memory multiHash
    ) external {
        if (!policiesRegistryContract.checkPolicy("Timestamp:updateHashAlgorithm", msg.sender)) {
            revert PolicyAttributeMissing("Timestamp:updateHashAlgorithm");
        }
        hashAlgos.updateHashAlgorithm(hashAlgorithmId, outputLength, ianaName, oid, status, multiHash);
    }

    /// @inheritdoc ITimestamp
    function commitTimestampHashes(bytes32 commitment) external {
        timestamps.commitTimestampHashes(commitment);
    }

    /// @inheritdoc ITimestamp
    function computeTimestampCommitment(
        address committedBy,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes32 salt
    ) external view returns (bytes32 commitment) {
        return TimestampLib.computeCommitment(committedBy, hashAlgorithmIds, hashValues, timestampData, salt);
    }

    /// @inheritdoc ITimestamp
    function getTimestampCommitmentBlock(address committedBy, bytes32 commitment)
        external
        view
        returns (uint64 blockNumber)
    {
        return timestamps.getCommitmentBlock(committedBy, commitment);
    }

    /// @inheritdoc ITimestamp
    function getTimestampCommitBlock(bytes32 timestampId) external view returns (uint64 commitBlockNumber) {
        return timestamps.getTimestampCommitBlock(timestampId);
    }

    /// @inheritdoc ITimestamp
    function timestampVersionHashes(
        bytes calldata versionHash,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external {
        bytes32[] memory timestampIds = timestamps.timestampHashes(
            hashAlgos, hashAlgorithmIds, hashValues, timestampData, salt
        );
        records.timestampVersionHashes(versionHash, timestampIds, versionInfo);
        emit TimestampVersionHashes(versionHash, timestampIds, versionInfo);
    }

    /// @inheritdoc ITimestamp
    function timestampRecordHashes(
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external returns (bytes32 recordId) {
        bytes32[] memory timestampIds =
            timestamps.timestampHashes(hashAlgos, hashAlgorithmIds, hashValues, timestampData, salt);
        return records.timestampRecordHashes(hashValues[0], timestampIds, versionInfo);
    }

    /// @inheritdoc ITimestamp
    function timestampRecordVersionHashes(
        bytes32 recordId,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external {
        bytes32[] memory timestampIds = timestamps.timestampHashes(
            hashAlgos, hashAlgorithmIds, hashValues, timestampData, salt
        );

        records.timestampRecordVersionHashes(recordId, timestampIds, versionInfo);
    }

    /// @inheritdoc ITimestamp
    function appendRecordVersionHashes(
        bytes32 recordId,
        uint256 versionId,
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes calldata versionInfo,
        bytes32 salt
    ) external {
        bytes32[] memory timestampIds = timestamps.timestampHashes(
            hashAlgos, hashAlgorithmIds, hashValues, timestampData, salt
        );

        records.appendRecordVersionHashes(recordId, versionId, timestampIds, versionInfo);
    }

    /// @inheritdoc ITimestamp
    function insertRecordVersionInfo(bytes32 recordId, uint256 versionId, bytes calldata versionInfo) external {
        records.insertRecordVersionInfo(recordId, versionId, versionInfo);
    }

    /// @inheritdoc ITimestamp
    function detachRecordVersionHash(bytes32 recordId, uint256 versionId, bytes calldata hashValue) external {
        records.detachRecordVersionHash(timestamps, recordId, versionId, hashValue);
    }

    /// @inheritdoc ITimestamp
    function insertRecordOwner(bytes32 recordId, string calldata ownerId, uint256 notBefore, uint256 notAfter)
        external
    {
        records.insertRecordOwner(recordId, ownerId, notBefore, notAfter);
    }

    /// @inheritdoc ITimestamp
    function revokeRecordOwner(bytes32 recordId, string calldata ownerId) external {
        records.revokeRecordOwner(recordId, ownerId);
    }

    /// @inheritdoc ITimestamp
    function timestampHashes(
        uint256[] calldata hashAlgorithmIds,
        bytes[] calldata hashValues,
        bytes[] calldata timestampData,
        bytes32 salt
    ) external returns (bytes32[] memory timestampIds) {
        timestampIds = timestamps.timestampHashes(hashAlgos, hashAlgorithmIds, hashValues, timestampData, salt);
        return timestampIds;
    }

    /// @inheritdoc ITimestamp
    function getHashAlgorithmById(uint256 hashAlgorithmId)
        external
        view
        returns (
            uint256 outputLength,
            string memory ianaName,
            string memory oid,
            Status status,
            string memory multiHash
        )
    {
        return hashAlgos.getHashAlgorithmById(hashAlgorithmId);
    }

    /// @inheritdoc ITimestamp
    function getHashAlgorithms(uint256 page, uint256 pageSize)
        external
        view
        returns (uint256[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        return hashAlgos.getHashAlgorithms(page, pageSize);
    }

    /// @inheritdoc ITimestamp
    function getRecordOwnerInfo(bytes32 recordId, string calldata ownerId)
        external
        view
        returns (bool revoked, uint256 notBefore, uint256 notAfter)
    {
        return records.getRecordOwnerInfo(recordId, ownerId);
    }

    /// @inheritdoc ITimestamp
    function getRecordIdsByOwnerId(string calldata ownerId, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        if (bytes(ownerId).length == 0) revert OwnerIdEmpty();
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = records.ownerIdToRecordIds[ownerId].length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = records.ownerIdToRecordIds[ownerId][ids[i]];
        }
    }

    /// @inheritdoc ITimestamp
    function getRecordIds(uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = records.recordIdsList.length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = records.recordIdsList[ids[i]];
        }
    }

    /// @inheritdoc ITimestamp
    function getRecordIdsByFirstVersionHash(bytes calldata hashValue, uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (hashValue.length == 0) revert HashValueEmpty();
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        bytes32 sha256HashValue = sha256(hashValue);
        uint256[] memory ids;
        (ids, total, howMany, prev, next) =
            records.firstVersionTimestampToRecordIds[sha256HashValue].length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = records.firstVersionTimestampToRecordIds[sha256HashValue][ids[i]];
        }
    }

    /// @inheritdoc ITimestamp
    function getRecord(bytes32 recordId)
        external
        view
        returns (string[] memory ownerIds, string[] memory revokedOwnerIds, uint256 totalVersions)
    {
        if (recordId == bytes32(0)) revert RecordIdEmpty();
        totalVersions = records.recordsStore[recordId].totalVersions;
        if (totalVersions == 0) revert RecordUnknown();
        ownerIds = records.recordsStore[recordId].owners;
        revokedOwnerIds = records.recordsStore[recordId].revokedOwnerIds;
    }

    /// @inheritdoc ITimestamp
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
        )
    {
        if (recordId == bytes32(0)) revert RecordIdEmpty();
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        bytes32[] memory timestampIds;

        VersionDetails storage vd = records.recordsStore[recordId].versionsStore[versionId];
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = vd.timestampsIds.length.paginate(page, pageSize);
        timestampIds = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            timestampIds[i] = vd.timestampsIds[ids[i]];
        }
        // `total`/`howMany`/`prev`/`next` above describe `timestampIds` only. `info` is
        // returned unpaginated because its size is unrelated to the timestamps page size;
        // it is instead bounded at write time by RecordLib.MAX_VERSION_INFO_PER_VERSION.
        infoIds = vd.info;

        // For every timestampId in versionDetails.timestampIds get the timestamped hash
        hashAlgorithmIds = new uint256[](timestampIds.length);
        hashValues = new bytes[](timestampIds.length);
        for (uint256 i = 0; i < timestampIds.length; i++) {
            hashAlgorithmIds[i] = timestamps.timestampsStore[timestampIds[i]].hash.algorithm;
            hashValues[i] = timestamps.timestampsStore[timestampIds[i]].hash.value;
        }
    }

    /// @inheritdoc ITimestamp
    function getRecordVersionInfo(bytes32 versionInfoId) external view returns (bytes memory info) {
        if (versionInfoId == bytes32(0)) revert VersionInfoIdEmpty();
        return records.versionInfoStore[versionInfoId];
    }

    /// @inheritdoc ITimestamp
    function getTimestamps(uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
        uint256[] memory timestampIds;
        (timestampIds, total, howMany, prev, next) = timestamps.timestampIdsList.length.paginate(page, pageSize);
        bytes32[] memory itemsFetched = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            itemsFetched[i] = timestamps.timestampIdsList[timestampIds[i]];
        }
        items = itemsFetched;
    }

    /// @inheritdoc ITimestamp
    function getTimestamp(bytes calldata hashValue)
        external
        view
        returns (Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data)
    {
        return timestamps.getTimestamp(hashValue);
    }

    /// @inheritdoc ITimestamp
    function getTimestampById(bytes32 timestampId)
        external
        view
        returns (Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data)
    {
        return timestamps.getTimestampById(timestampId);
    }

    uint256[50] private __gap;
}
