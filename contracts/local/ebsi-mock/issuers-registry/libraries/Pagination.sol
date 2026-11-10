// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/IIssuersRegistry.sol";

library Pagination {
    /// @dev Maximum page size accepted by all pagination overloads.
    uint256 internal constant MAX_PAGE_SIZE = 50;

    function requireValidParams(uint256 page, uint256 pageSize) internal pure {
        if (pageSize > MAX_PAGE_SIZE) {
            revert IIssuersRegistry.PageSizeTooLarge();
        }
        if (pageSize == 0) revert IIssuersRegistry.PageSizeZero();
        if (page == 0) revert IIssuersRegistry.PageZero();
    }

    function getPaginationParameters(uint256 total, uint256 page, uint256 pageSize)
        internal
        pure
        returns (uint256 cursor, uint256 howMany, uint256 prev, uint256 next)
    {
        requireValidParams(page, pageSize);

        uint256 mod = total % pageSize;
        uint256 lastPage = total / pageSize;
        if (mod > 0) lastPage += 1;

        // Out-of-range pages return an empty window without multiplying the
        // cursor — large page numbers must not overflow.
        if (page > lastPage) {
            uint256 edge = lastPage == 0 ? 1 : lastPage;
            return (0, 0, edge, edge);
        }

        if (page == lastPage && mod != 0) {
            howMany = mod;
        } else {
            howMany = pageSize;
        }

        cursor = (page - 1) * pageSize;

        next = page + 1;
        if (next > lastPage) {
            next = lastPage;
        }

        prev = page == 1 ? 1 : page - 1;

        return (cursor, howMany, prev, next);
    }

    function paginate(string[] storage self, uint256 page, uint256 pageSize)
        internal
        view
        returns (string[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = getPaginationParameters(self.length, page, pageSize);
        items = new string[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = self[cursor + i];
            }
        }

        return (items, self.length, howMany, prev, next);
    }

    function paginate(bytes32[] memory self, uint256 page, uint256 pageSize)
        internal
        pure
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = getPaginationParameters(self.length, page, pageSize);
        items = new bytes32[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = self[cursor + i];
            }
        }

        return (items, self.length, howMany, prev, next);
    }

    /* Paginate Ids based on the number of Ids.
       Id is incremental, the first index is 0.
       Self corresponds to the total number of ids   */
    function paginate(uint256 self, uint256 page, uint256 pageSize)
        internal
        pure
        returns (uint256[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = getPaginationParameters(self, page, pageSize);
        items = new uint256[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = cursor + i;
            }
        }

        return (items, self, howMany, prev, next);
    }

    function paginate(bytes[] storage self, uint256 page, uint256 pageSize)
        internal
        view
        returns (bytes[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = getPaginationParameters(self.length, page, pageSize);
        items = new bytes[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = self[cursor + i];
            }
        }

        return (items, self.length, howMany, prev, next);
    }

    function paginate(address[] memory self, uint256 page, uint256 pageSize)
        internal
        pure
        returns (address[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = getPaginationParameters(self.length, page, pageSize);
        items = new address[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = self[cursor + i];
            }
        }

        return (items, self.length, howMany, prev, next);
    }
}
