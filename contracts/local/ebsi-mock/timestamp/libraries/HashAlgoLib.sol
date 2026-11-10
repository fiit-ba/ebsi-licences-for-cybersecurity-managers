// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/ITimestamp.sol";
import "../../bootstrap/utils/Pagination.sol";

library HashAlgoLib {
    using Pagination for uint256;

    event AddNewHashAlgo(
        uint256 indexed hashId,
        string indexed ianaNameHash,
        uint256 outputLength,
        string oid,
        ITimestamp.Status status,
        string multiHash
    );

    event UpdateHashAlgo(
        uint256 indexed hashId,
        string indexed ianaNameHash,
        string ianaName,
        uint256 outputLength,
        string oid,
        ITimestamp.Status status,
        string multiHash
    );

    /**
     * @dev insertHashAlgorithm enables to register a new hash algorithm.
     */
    function insertHashAlgorithm(
        ITimestamp.HashAlgos storage hs,
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        ITimestamp.Status status,
        string memory multiHash
    ) external {
        if (uint256(status) == 0) revert ITimestamp.StatusUndefined();
        if (bytes(ianaName).length == 0) revert ITimestamp.IanaNameUnknown();
        if (hs.ianaNameDefined[ianaName]) revert ITimestamp.IanaNameDefined();
        uint256 hashId = hs.numberOfAlgorithms;

        hs.hashAlgorithms[hashId] = ITimestamp.HashAlgoInfo(outputLength, ianaName, oid, status, multiHash);
        hs.ianaNameDefined[ianaName] = true;

        hs.numberOfAlgorithms++;

        emit AddNewHashAlgo(hashId, ianaName, outputLength, oid, status, multiHash);
    }

    /**
     * @dev updateHashAlgorithm updates an existing hash algorithm info.
     */
    function updateHashAlgorithm(
        ITimestamp.HashAlgos storage hs,
        uint256 hashAlgorithmId,
        uint256 outputLength,
        string memory ianaName,
        string memory oid,
        ITimestamp.Status status,
        string memory multiHash
    ) external {
        if (uint256(status) == 0) revert ITimestamp.StatusUndefined();
        if (hashAlgorithmId >= hs.numberOfAlgorithms) {
            revert ITimestamp.HashAlgorithmIdUnknown();
        }
        if (bytes(ianaName).length == 0) revert ITimestamp.IanaNameUnknown();
        string memory currentName = hs.hashAlgorithms[hashAlgorithmId].ianaName;
        if (keccak256(bytes(ianaName)) != keccak256(bytes(currentName))) {
            if (hs.ianaNameDefined[ianaName]) {
                revert ITimestamp.IanaNameDefined();
            }
        }
        hs.ianaNameDefined[currentName] = false;
        hs.ianaNameDefined[ianaName] = true;

        hs.hashAlgorithms[hashAlgorithmId] = ITimestamp.HashAlgoInfo(outputLength, ianaName, oid, status, multiHash);

        emit UpdateHashAlgo(hashAlgorithmId, ianaName, ianaName, outputLength, oid, status, multiHash);
    }

    /**
     * @dev Returns the hash algorithm details by the algorithm id
     */
    function getHashAlgorithmById(ITimestamp.HashAlgos storage hs, uint256 hashAlgorithmId)
        external
        view
        returns (
            uint256 outputLength,
            string memory ianaName,
            string memory oid,
            ITimestamp.Status status,
            string memory multiHash
        )
    {
        if (hs.hashAlgorithms[hashAlgorithmId].status == ITimestamp.Status.undefined) {
            revert ITimestamp.HashAlgoUnknown();
        }

        outputLength = hs.hashAlgorithms[hashAlgorithmId].outputLength;
        ianaName = hs.hashAlgorithms[hashAlgorithmId].ianaName;
        oid = hs.hashAlgorithms[hashAlgorithmId].oid;
        status = hs.hashAlgorithms[hashAlgorithmId].status;
        multiHash = hs.hashAlgorithms[hashAlgorithmId].multiHash;
    }

    /**
     * @dev Returns a paginated list of registered hash algorithm IDs.
     */
    function getHashAlgorithms(ITimestamp.HashAlgos storage hs, uint256 page, uint256 pageSize)
        external
        view
        returns (uint256[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert ITimestamp.PageSizeTooLarge();
        if (pageSize == 0) revert ITimestamp.PageSizeZero();
        if (page == 0) revert ITimestamp.PageZero();

        return hs.numberOfAlgorithms.paginate(page, pageSize);
    }
}
