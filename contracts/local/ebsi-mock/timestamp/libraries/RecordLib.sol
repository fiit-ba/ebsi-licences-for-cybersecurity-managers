// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/ITimestamp.sol";
import "../../bootstrap/utils/StringManip.sol";
import "./TimestampLib.sol";

library RecordLib {
    using StringManip for address;
    using TimestampLib for ITimestamp.Timestamps;
    uint256 public constant MAX_TIMESTAMPS_PER_VERSION = 10;
    uint256 public constant MAX_RECORDS_PER_TIMESTAMP = 10;
    uint256 public constant MAX_VERSION_INFO_PER_VERSION = 10;

    event RecordedHashes(bytes32 indexed recordId, bytes32[] timestampIds, bytes32 versionInfoHash);
    event RecordVersionInfo(bytes32 indexed recordId, bytes32 versionInfoHash, uint256 versionId);
    event TimestampIdDetached(bytes32 timestampId);
    event RecordOwnerAdded(string ownerId);
    event OwnerIdRevoked(string ownerId);

    /**
     * @dev  checkIfOwnerExist checks if the sender is the owner of the record
     */
    function checkIfOwnerExist(address ownerId, ITimestamp.Record storage record) internal view returns (bool) {
        string memory ownerIdStr = ownerId.convertToString();
        if (record.ownerIndex[ownerIdStr] == 0) return false;
        ITimestamp.OwnerInfo memory owner = record.ownerInfo[ownerIdStr];
        return !owner.revoked && block.timestamp >= owner.notBefore && block.timestamp <= owner.notAfter;
    }

    function _addTimestampsToVersion(
        ITimestamp.Records storage rs,
        ITimestamp.Record storage record,
        ITimestamp.VersionDetails storage vd,
        bytes32[] calldata timestampIds,
        bytes32 recordId,
        uint256 versionId
    ) internal {
        for (uint256 i = 0; i < timestampIds.length; i++) {
            if (!vd.timestampExist[timestampIds[i]]) {
                vd.timestampsIds.push(timestampIds[i]);
                vd.timestampExist[timestampIds[i]] = true;
                record.timestampIdToVersionId[timestampIds[i]] = versionId;
                // one more version of this record now holds that timestamp
                record.timestampVersionCount[timestampIds[i]]++;
                // add this new timestampId to the record list
                if (!rs.checkTimestampIdToRecordIdExist[timestampIds[i]][recordId]) {
                    if (rs.timestampIdToRecordIds[timestampIds[i]].length >= MAX_RECORDS_PER_TIMESTAMP) {
                        revert ITimestamp.RecordsPerTimestampLimitExceeded();
                    }
                    rs.timestampIdToRecordIds[timestampIds[i]].push(recordId);
                    rs.checkTimestampIdToRecordIdExist[timestampIds[i]][recordId] = true;
                }
                // version 0 is the record's first version, so the first version
                // index has to stay in step with it however the timestamp got
                // attached: at record creation or by a later append to version 0.
                // The timestampExist guard above makes this push duplicate free.
                if (versionId == 0) {
                    if (rs.firstVersionTimestampToRecordIds[timestampIds[i]].length >= MAX_RECORDS_PER_TIMESTAMP) {
                        revert ITimestamp.RecordsPerTimestampLimitExceededInFirstVersion();
                    }
                    rs.firstVersionTimestampToRecordIds[timestampIds[i]].push(recordId);
                }
            }
        }
    }

    /**
     * @dev  _recordVersionInfo stores `versionInfo` (deduplicated by content hash) and, for
     *       genuinely new content, appends its hash to `vd.info`, enforcing
     *       MAX_VERSION_INFO_PER_VERSION on that append.
     */
    function _recordVersionInfo(
        ITimestamp.Records storage rs,
        ITimestamp.VersionDetails storage vd,
        bytes calldata versionInfo
    ) internal returns (bytes32 versionInfoHash) {
        versionInfoHash = sha256(versionInfo);
        if (rs.versionInfoStore[versionInfoHash].length == 0) {
            if (vd.info.length >= MAX_VERSION_INFO_PER_VERSION) {
                revert ITimestamp.VersionInfoPerVersionLimitExceeded();
            }
            // removal of SafeAddArray
            vd.info.push(versionInfoHash);
        }
        rs.versionInfoStore[versionInfoHash] = versionInfo;
    }

    /**
     * @dev  timestampVersionHashes enables subjects to timestamp up to three (version) hashes
     *                              of different types at a time and store the timestamps under
     *                              the given record. It creates a new version inside the record to store
     *                              the new timestamps
     */
    function timestampVersionHashes(
        ITimestamp.Records storage rs,
        bytes calldata versionHash,
        bytes32[] calldata timestampIds,
        bytes calldata versionInfo
    ) external {
        if (versionHash.length == 0) revert ITimestamp.VersionHashEmpty();
        //Compute timestampid from the versionHash to get the corresponding recordIds
        bytes32 tsId = sha256(versionHash);
        bytes32[] memory recordIds = rs.timestampIdToRecordIds[tsId];
        // if you have more than one you should call timestampRecordVersionHashes
        // and if you have zero you should call timestampRecordHashes
        if (recordIds.length != 1) revert ITimestamp.WrongRecordCount();

        ITimestamp.Record storage record = rs.recordsStore[recordIds[0]];
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        ITimestamp.VersionDetails storage vd = record.versionsStore[record.totalVersions];

        // No need to check MAX_TIMESTAMPS_PER_VERSION because
        // it is a new version, that is, no previous timestamps

        _addTimestampsToVersion(rs, record, vd, timestampIds, recordIds[0], record.totalVersions);

        if (versionInfo.length > 0) {
            _recordVersionInfo(rs, vd, versionInfo);
        }
        // increment version numbers
        record.totalVersions++;
    }

    /**
     * @dev  timestampRecordHashes enables subjects to timestamp up to three record hashes
     *       of different types at a time. The method will create timestamps and collect
     *       the timestampIds in a record. hashValue is the hash of the first version of
     *       the timestamped object needed to calculate the recordId
     */
    function timestampRecordHashes(
        ITimestamp.Records storage rs,
        bytes calldata hashValue,
        bytes32[] calldata timestampIds,
        bytes calldata versionInfo
    ) external returns (bytes32 recordId) {
        //Compute record unique id as  SHA2-256(tx.signer.address || BlockNumber || hashValue of the timestamp object)
        recordId = sha256(abi.encode(msg.sender, block.number, hashValue));

        ITimestamp.Record storage record = rs.recordsStore[recordId];
        if (record.totalVersions != 0) revert ITimestamp.RecordExists();
        rs.recordIdsList.push(recordId);

        string memory ownerId = msg.sender.convertToString();

        if (record.ownerIndex[ownerId] == 0) {
            record.owners.push(ownerId);
            record.ownerIndex[ownerId] = record.owners.length;
        }
        rs.ownerIdToRecordIds[ownerId].push(recordId);
        rs.indexOwnerIdToRecordIds[ownerId][recordId] = rs.ownerIdToRecordIds[ownerId].length;

        // solhint-disable-next-line
        record.ownerInfo[ownerId] = ITimestamp.OwnerInfo(block.timestamp, type(uint256).max, false);
        ITimestamp.VersionDetails storage vd = record.versionsStore[0];

        // No need to check MAX_TIMESTAMPS_PER_VERSION because
        // it is a new version, that is, no previous timestamps

        // _addTimestampsToVersion also registers these timestamps in the first
        // version index, since this is version 0 of the record
        _addTimestampsToVersion(rs, record, vd, timestampIds, recordId, 0);
        if (versionInfo.length > 0) {
            bytes32 versionInfoHash = _recordVersionInfo(rs, vd, versionInfo);
            emit RecordedHashes(recordId, timestampIds, versionInfoHash);
        } else {
            emit RecordedHashes(recordId, timestampIds, bytes32(0));
        }

        // increment version numbers
        record.totalVersions++;
    }

    /**
     * @dev  timestampRecordVersionHashes enables subjects to timestamp up to three (version) hashes
     *                                 of different types at a time and store the timestamps under the given record.
     */
    function timestampRecordVersionHashes(
        ITimestamp.Records storage rs,
        bytes32 recordId,
        bytes32[] calldata timestampIds,
        bytes calldata versionInfo
    ) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        // check record exists
        ITimestamp.Record storage record = rs.recordsStore[recordId];

        if (record.totalVersions == 0) revert ITimestamp.RecordUnknown();
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        // create a new version detail

        ITimestamp.VersionDetails storage vd = record.versionsStore[record.totalVersions];

        // No need to check MAX_TIMESTAMPS_PER_VERSION because
        // it is a new version, that is, no previous timestamps

        _addTimestampsToVersion(rs, record, vd, timestampIds, recordId, record.totalVersions);

        if (versionInfo.length > 0) {
            bytes32 versionInfoHash = _recordVersionInfo(rs, vd, versionInfo);
            emit RecordedHashes(recordId, timestampIds, versionInfoHash);
        } else {
            emit RecordedHashes(recordId, timestampIds, bytes32(0));
        }
        // increment version numbers
        record.totalVersions++;
    }

    /**
     * @dev  appendRecordVersionHashes enables to append new types of hashes to a given version.
     *       The method will timestamp the hash(es) and add them to the given version of a Record.
     */
    function appendRecordVersionHashes(
        ITimestamp.Records storage rs,
        bytes32 recordId,
        uint256 versionId,
        bytes32[] calldata timestampIds,
        bytes calldata versionInfo
    ) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        ITimestamp.Record storage record = rs.recordsStore[recordId];
        ITimestamp.VersionDetails storage vd = record.versionsStore[versionId];

        if (vd.timestampsIds.length == 0) {
            revert ITimestamp.RecordVersionUnknown();
        }
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        if (vd.timestampsIds.length + timestampIds.length > MAX_TIMESTAMPS_PER_VERSION) {
            revert ITimestamp.TimestampsPerVersionLimitExceeded();
        }

        _addTimestampsToVersion(rs, record, vd, timestampIds, recordId, versionId);

        if (versionInfo.length > 0) {
            bytes32 versionInfoHash = _recordVersionInfo(rs, vd, versionInfo);
            emit RecordedHashes(recordId, timestampIds, versionInfoHash);
        } else {
            emit RecordedHashes(recordId, timestampIds, bytes32(0));
        }
    }

    /**
     * @dev  insertRecordVersionInfo enables to insert additional version info.
     */
    function insertRecordVersionInfo(
        ITimestamp.Records storage rs,
        bytes32 recordId,
        uint256 versionId,
        bytes calldata versionInfo
    ) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        if (versionInfo.length == 0) revert ITimestamp.VersionInfoEmpty();
        ITimestamp.VersionDetails storage vd = rs.recordsStore[recordId].versionsStore[versionId];
        if (vd.timestampsIds.length == 0) {
            revert ITimestamp.RecordVersionUnknown();
        }
        if (!checkIfOwnerExist(msg.sender, rs.recordsStore[recordId])) {
            revert ITimestamp.SenderNotOwner();
        }

        bytes32 versionInfoHash = _recordVersionInfo(rs, vd, versionInfo);
        emit RecordVersionInfo(recordId, versionInfoHash, versionId);
    }

    /**
     * @dev  detachRecordVersionHash detaches a timestamp id (computed from the hash value) from the given version.
     */
    function detachRecordVersionHash(
        ITimestamp.Records storage rs,
        ITimestamp.Timestamps storage ts,
        bytes32 recordId,
        uint256 versionId,
        bytes calldata hashValue
    ) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        if (hashValue.length == 0) revert ITimestamp.HashValueEmpty();
        ITimestamp.Record storage record = rs.recordsStore[recordId];
        ITimestamp.VersionDetails storage vd = record.versionsStore[versionId];
        if (vd.timestampsIds.length == 0) {
            revert ITimestamp.RecordVersionUnknown();
        }
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        bytes32 timestampId = sha256(hashValue);
        // check that the timestampId exists in the timestampsStore
        if (ts.timestampsStore[timestampId].hash.value.length == 0) {
            revert ITimestamp.TimestampIdUnknown();
        }

        // the timestamp must actually be attached to this version, otherwise the
        // cleanup below would corrupt the record indexes for an unrelated version
        if (!vd.timestampExist[timestampId]) {
            revert ITimestamp.TimestampNotInVersion();
        }

        // remove timestampId from versionDetail
        for (uint256 i = 0; i < vd.timestampsIds.length; i++) {
            if (vd.timestampsIds[i] == timestampId) {
                vd.timestampsIds[i] = vd.timestampsIds[vd.timestampsIds.length - 1];
                vd.timestampsIds.pop();
                vd.timestampExist[timestampId] = false;
                // one less version of this record holds that timestamp. The
                // timestampExist guard above means the count is at least 1 here.
                record.timestampVersionCount[timestampId]--;
                emit TimestampIdDetached(timestampId);
                break;
            }
        }

        if (vd.timestampsIds.length == 0) {
            delete vd.info;
            while (
                record.totalVersions > 1 && record.versionsStore[record.totalVersions - 1].timestampsIds.length == 0
            ) {
                delete record.versionsStore[record.totalVersions - 1].info;
                record.totalVersions--;
            }
        }

        // remove recordId from timestampIdToRecordIds, but only once the timestamp
        // is detached from every version: the record still references it otherwise
        if (record.timestampVersionCount[timestampId] == 0) {
            for (uint256 i = 0; i < rs.timestampIdToRecordIds[timestampId].length; i++) {
                if (rs.timestampIdToRecordIds[timestampId][i] == recordId) {
                    rs.timestampIdToRecordIds[timestampId][i] =
                        rs.timestampIdToRecordIds[timestampId][rs.timestampIdToRecordIds[timestampId].length - 1];
                    rs.timestampIdToRecordIds[timestampId].pop();
                    rs.checkTimestampIdToRecordIdExist[timestampId][recordId] = false;
                    break;
                }
            }
        }

        // remove recordId from firstVersionTimestampToRecordIds. That index only ever
        // holds version 0 timestamps, so detaching from a later version must leave it
        // untouched even when the same timestamp is attached to both versions.
        if (versionId == 0) {
            for (uint256 i = 0; i < rs.firstVersionTimestampToRecordIds[timestampId].length; i++) {
                if (rs.firstVersionTimestampToRecordIds[timestampId][i] == recordId) {
                    rs.firstVersionTimestampToRecordIds[timestampId][i] = rs.firstVersionTimestampToRecordIds[
                        timestampId
                    ][rs.firstVersionTimestampToRecordIds[timestampId].length - 1];
                    rs.firstVersionTimestampToRecordIds[timestampId].pop();
                    break;
                }
            }
        }
    }

    /**
     * @dev insertRecordOwner enables to insert an owner address to the record. OwnerIds list.
     */
    function insertRecordOwner(
        ITimestamp.Records storage rs,
        bytes32 recordId,
        string calldata ownerId,
        uint256 notBefore,
        uint256 notAfter
    ) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        if (bytes(ownerId).length == 0) revert ITimestamp.OwnerIdEmpty();
        if (!(notAfter > 0 ? notAfter > notBefore && notBefore > 0 : notBefore > 0)) revert ITimestamp.DateIncorrect();
        ITimestamp.Record storage record = rs.recordsStore[recordId];
        if (record.totalVersions == 0) revert ITimestamp.RecordUnknown();
        if (!(record.ownerInfo[ownerId].notBefore == 0 || record.ownerInfo[ownerId].revoked)) {
            revert ITimestamp.OwnerIdExists();
        }
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        if (record.ownerIndex[ownerId] == 0) {
            // removal of SafeAddArray
            record.owners.push(ownerId);
            record.ownerIndex[ownerId] = record.owners.length;
        }
        rs.ownerIdToRecordIds[ownerId].push(recordId);
        rs.indexOwnerIdToRecordIds[ownerId][recordId] = rs.ownerIdToRecordIds[ownerId].length;
        // increment owners
        if (record.ownerInfo[ownerId].revoked) {
            record.revokedOwnerIdsToBlockNum[ownerId] = 0;
            ITimestamp.RevokedOwner storage ro = record.revokedOwnerIndex[ownerId];
            string memory movedOwner = record.revokedOwnerIds[record.revokedOwnerIds.length - 1];
            record.revokedOwnerIds[ro.index] = movedOwner;
            record.revokedOwnerIndex[movedOwner].index = ro.index;
            record.revokedOwnerIds.pop();
            ro.exists = false;
            ro.index = 0;
        }
        record.ownerInfo[ownerId] = ITimestamp.OwnerInfo(notBefore, notAfter == 0 ? type(uint256).max : notAfter, false);
        emit RecordOwnerAdded(ownerId);
    }

    /**
     * @dev revokeRecordOwner enables to revoke an existing record owner.
     *      Revoked owner's address is removed from record.OwnerIds list
     *      and is added to the record.revokedOwnerIds list.
     */
    function revokeRecordOwner(ITimestamp.Records storage rs, bytes32 recordId, string calldata ownerId) external {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        if (bytes(ownerId).length == 0) revert ITimestamp.OwnerIdEmpty();
        ITimestamp.Record storage record = rs.recordsStore[recordId];
        if (record.totalVersions == 0) revert ITimestamp.RecordUnknown();
        if (!checkIfOwnerExist(msg.sender, record)) {
            revert ITimestamp.SenderNotOwner();
        }

        // remove ownerId from owners
        if (record.ownerIndex[ownerId] == 0) revert ITimestamp.OwnerIdUnknown();
        if (record.owners.length <= 1) {
            revert ITimestamp.CannotRevokeLastOwner();
        }
        record.owners[record.ownerIndex[ownerId] - 1] = record.owners[record.owners.length - 1];
        record.ownerIndex[record.owners[record.owners.length - 1]] = record.ownerIndex[ownerId];
        record.owners.pop();
        record.ownerIndex[ownerId] = 0;

        if (!record.ownerInfo[ownerId].revoked) {
            // removal of SafeAddArray
            record.revokedOwnerIndex[ownerId].index = record.revokedOwnerIds.length;
            record.revokedOwnerIndex[ownerId].exists = true;
            record.revokedOwnerIds.push(ownerId);
        }
        // Remove the record owner from ownerIdToRecordIds map.
        rs.ownerIdToRecordIds[ownerId][rs.indexOwnerIdToRecordIds[ownerId][recordId] - 1] =
            rs.ownerIdToRecordIds[ownerId][rs.ownerIdToRecordIds[ownerId].length - 1];
        rs.indexOwnerIdToRecordIds[ownerId][rs.ownerIdToRecordIds[ownerId][rs.ownerIdToRecordIds[ownerId].length - 1]] =
                rs.indexOwnerIdToRecordIds[ownerId][recordId];
        rs.ownerIdToRecordIds[ownerId].pop();
        rs.indexOwnerIdToRecordIds[ownerId][recordId] = 0;

        // set the ownerInfo to revoked
        record.ownerInfo[ownerId].revoked = true;
        record.revokedOwnerIdsToBlockNum[ownerId] = block.number;
        emit OwnerIdRevoked(ownerId);
    }

    /**
     * @dev getRecordOwnerInfo returns the record's owner info.
     */
    function getRecordOwnerInfo(ITimestamp.Records storage rs, bytes32 recordId, string calldata ownerId)
        external
        view
        returns (bool revoked, uint256 notBefore, uint256 notAfter)
    {
        if (recordId == bytes32(0)) revert ITimestamp.RecordIdEmpty();
        if (bytes(ownerId).length == 0) revert ITimestamp.OwnerIdEmpty();
        ITimestamp.Record storage record = rs.recordsStore[recordId];
        if (record.totalVersions == 0) revert ITimestamp.RecordUnknown();

        return
            (record.ownerInfo[ownerId].revoked, record.ownerInfo[ownerId].notBefore, record.ownerInfo[ownerId].notAfter);
    }
}
