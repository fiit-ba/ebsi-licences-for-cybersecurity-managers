// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/ITimestamp.sol";

library TimestampLib {
    /**
     * @dev Blocks that must elapse after a commit before a reveal is accepted.
     */
    uint64 internal constant TIMESTAMP_COMMITMENT_MATURITY = 5;

    /**
     * @dev EIP-712 type hash of the commitment. It pins down the meaning of every field that is
     * hashed into a commitment, so a commitment can never be mistaken for the hash of another
     * structure, on this contract or on any other one.
     */
    bytes32 internal constant TIMESTAMP_COMMITMENT_TYPEHASH = keccak256(
        // solhint-disable-next-line max-line-length
        "TimestampCommitment(uint256 chainId,address verifyingContract,address committedBy,uint256[] hashAlgorithmIds,bytes[] hashValues,bytes[] timestampData,bytes32 salt)"
    );

    event TimestampedHashes(
        bytes32[] timestampIds,
        uint256[] hashAlgorithmIds,
        bytes[] hashValues,
        bytes[] timestampData,
        uint64 commitBlockNumber
    );

    event TimestampHashesCommitted(address indexed committedBy, bytes32 indexed commitment, uint64 blockNumber);

    /**
     * @dev registers a commitment for a later reveal through one of the timestamping functions.
     * The commitment is stored per sender, so front-running the commit transaction itself does
     * not help an adversary: the commitment hides the hash values until the reveal.
     */
    function commitTimestampHashes(ITimestamp.Timestamps storage ts, bytes32 commitment) external {
        if (commitment == bytes32(0)) revert ITimestamp.CommitmentEmpty();
        if (ts.commitments[msg.sender][commitment] != 0) {
            revert ITimestamp.CommitmentExists();
        }
        ts.commitments[msg.sender][commitment] = uint64(block.number);
        emit TimestampHashesCommitted(msg.sender, commitment, uint64(block.number));
    }

    /**
     * @dev computes the commitment binding the committer, this contract, the chain and the
     * arguments of the reveal. `salt` is the committer's secret and is what makes the commitment
     * unpredictable for anybody who could otherwise guess the hash values. The fields are encoded
     * following the EIP-712 `encodeData` rules: the type hash first, then every member, with the
     * dynamic ones replaced by their keccak256 hash.
     */
    function computeCommitment(
        address committedBy,
        uint256[] memory hashAlgorithmIds,
        bytes[] memory hashValues,
        bytes[] memory timestampData,
        bytes32 salt
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                TIMESTAMP_COMMITMENT_TYPEHASH,
                block.chainid,
                address(this),
                committedBy,
                keccak256(abi.encodePacked(hashAlgorithmIds)),
                hashBytesArray(hashValues),
                hashBytesArray(timestampData),
                salt
            )
        );
    }

    /**
     * @dev EIP-712 encoding of a `bytes[]` member: the keccak256 of the concatenated hashes of the
     * elements. Hashing each element keeps the encoding unambiguous for variable-length entries.
     */
    function hashBytesArray(bytes[] memory values) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            hashes[i] = keccak256(values[i]);
        }
        return keccak256(abi.encodePacked(hashes));
    }

    /**
     * @dev returns the block in which `committedBy` registered `commitment`, or zero if unknown.
     */
    function getCommitmentBlock(ITimestamp.Timestamps storage ts, address committedBy, bytes32 commitment)
        external
        view
        returns (uint64)
    {
        return ts.commitments[committedBy][commitment];
    }

    /**
     * @dev reverts unless the sender committed to these exact arguments at least
     * {TIMESTAMP_COMMITMENT_MATURITY} blocks earlier, and returns the block of that commitment.
     * The maturity window is what prevents front-running: an adversary reading the revealed
     * arguments from the mempool can no longer place a matching commit and mature it in time.
     */
    function checkCommitment(
        ITimestamp.Timestamps storage ts,
        uint256[] memory hashAlgorithmIds,
        bytes[] memory hashValues,
        bytes[] memory timestampData,
        bytes32 salt
    ) internal view returns (uint64 commitBlock) {
        bytes32 commitment = computeCommitment(msg.sender, hashAlgorithmIds, hashValues, timestampData, salt);
        commitBlock = ts.commitments[msg.sender][commitment];
        if (commitBlock == 0) revert ITimestamp.CommitmentUnknown();
        if (block.number < uint256(commitBlock) + TIMESTAMP_COMMITMENT_MATURITY) {
            revert ITimestamp.CommitmentNotMatured();
        }
    }

    /**
     * @dev returns the commit block of the commitment `timestampedBy` revealed.
     */
    function getTimestampCommitBlock(ITimestamp.Timestamps storage ts, bytes32 timestampId)
        external
        view
        returns (uint64)
    {
        return ts.timestampsStore[timestampId].commitBlockNumber;
    }

    /**
     * @dev timestamps one or more hashes. Up to three hashes can be timestamped at a time.
     * Reveals a commitment previously registered with {commitTimestampHashes} at least
     * {TIMESTAMP_COMMITMENT_MATURITY} blocks earlier, which binds the recorded `timestampedBy`
     * to the address that committed to these hashes.
     */
    function timestampHashes(
        ITimestamp.Timestamps storage ts,
        ITimestamp.HashAlgos storage hs,
        uint256[] memory hashAlgorithmIds,
        bytes[] memory hashValues,
        bytes[] memory timestampData,
        bytes32 salt
    ) external returns (bytes32[] memory timestampIds) {
        if (hashAlgorithmIds.length > 3) {
            revert ITimestamp.TooManyHashAlgorithmIds();
        }
        if (hashValues.length > 3) revert ITimestamp.TooManyHashValues();
        if (timestampData.length > 3) revert ITimestamp.TooManyTimestampData();
        if (hashValues.length != hashAlgorithmIds.length) {
            revert ITimestamp.HashValueAlgoCountMismatch();
        }
        if (timestampData.length > hashValues.length) {
            revert ITimestamp.TimestampDataCountMismatch();
        }

        uint64 commitBlock = checkCommitment(ts, hashAlgorithmIds, hashValues, timestampData, salt);

        timestampIds = new bytes32[](hashAlgorithmIds.length);
        for (uint256 i = 0; i < hashAlgorithmIds.length; i++) {
            if (hashValues[i].length == 0) revert ITimestamp.HashValueEmpty();
            bytes32 tsId = sha256(hashValues[i]);
            timestampIds[i] = tsId;
            if (hs.hashAlgorithms[hashAlgorithmIds[i]].status == ITimestamp.Status.undefined) {
                revert ITimestamp.HashAlgoUnknown();
            }
            if (hs.hashAlgorithms[hashAlgorithmIds[i]].status != ITimestamp.Status.active) {
                revert ITimestamp.HashAlgoNotActive();
            }
            if (
                hs.hashAlgorithms[hashAlgorithmIds[i]].outputLength != 0
                    && hashValues[i].length * 8 != hs.hashAlgorithms[hashAlgorithmIds[i]].outputLength
            ) revert ITimestamp.HashValueLengthMismatch();
            if (ts.timestampsStore[tsId].hash.value.length == 0) {
                ts.timestampsStore[tsId] = ITimestamp.Timestamp(
                    ITimestamp.Hash(hashAlgorithmIds[i], hashValues[i]),
                    msg.sender,
                    commitBlock,
                    block.number,
                    timestampData.length > i ? timestampData[i] : bytes("")
                );
                ts.timestampIdsList.push(tsId);
            } else {
                // Re-timestamping a known hash stays legitimate, but the stored
                // entry is final: the first reveal keeps the attribution, the
                // data and the block the hash is proven to have existed in.
                if (ts.timestampsStore[tsId].hash.algorithm != hashAlgorithmIds[i]) {
                    revert ITimestamp.TimestampWithDifferentHashAlgo();
                }
            }
        }
        emit TimestampedHashes(timestampIds, hashAlgorithmIds, hashValues, timestampData, commitBlock);
        return timestampIds;
    }

    /**
     * @dev returns the timestamp of the hash. The timestamp is stored in the timestampsStore.
     */
    function getTimestamp(ITimestamp.Timestamps storage ts, bytes memory hashValue)
        public
        view
        returns (ITimestamp.Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data)
    {
        if (hashValue.length == 0) revert ITimestamp.HashEmpty();
        bytes32 tsId = sha256(hashValue);
        if (ts.timestampsStore[tsId].hash.value.length == 0) {
            revert ITimestamp.TimestampUnknown();
        }
        hash = ts.timestampsStore[tsId].hash;
        blockNumber = ts.timestampsStore[tsId].blockNumber;
        timestampedBy = ts.timestampsStore[tsId].timestampedBy;
        data = ts.timestampsStore[tsId].data;
    }

    /**
     * @dev returns the timestamp by timestampId (sha256(hashvalue)). The timestamp is stored in the timestampsStore.
     */
    function getTimestampById(ITimestamp.Timestamps storage ts, bytes32 timestampId)
        public
        view
        returns (ITimestamp.Hash memory hash, address timestampedBy, uint256 blockNumber, bytes memory data)
    {
        if (timestampId == bytes32(0)) revert ITimestamp.TimestampIdEmpty();

        if (ts.timestampsStore[timestampId].hash.value.length == 0) {
            revert ITimestamp.TimestampUnknown();
        }
        hash = ts.timestampsStore[timestampId].hash;
        blockNumber = ts.timestampsStore[timestampId].blockNumber;
        timestampedBy = ts.timestampsStore[timestampId].timestampedBy;
        data = ts.timestampsStore[timestampId].data;
    }
}
