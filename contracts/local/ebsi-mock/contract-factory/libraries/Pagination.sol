// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

library Pagination {
    function getPaginationParameters(uint256 total, uint256 page, uint256 pageSize)
        internal
        pure
        returns (uint256 cursor, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 curPage = page;
        uint256 mod = total % pageSize;

        uint256 lastPage = total / pageSize;
        if (mod > 0) lastPage = lastPage + 1;

        // calculate the number of items to get
        if (curPage > lastPage) {
            howMany = 0;
        } else if (curPage == lastPage && mod != 0) {
            howMany = mod;
        } else {
            howMany = pageSize;
        }

        // calculate the cursor
        cursor = (curPage - 1) * pageSize;

        // calculate prev and next pages
        next = curPage + 1;
        if (next > lastPage) {
            next = lastPage;
        }
        if (next == 0) {
            next = 1;
        }

        prev = curPage - 1;
        if (prev == 0) {
            prev = 1;
        } else if (prev > lastPage) {
            prev = lastPage;
        }

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

    function paginate(bytes32[] storage self, uint256 page, uint256 pageSize)
        internal
        view
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

    function paginate(address[] storage self, uint256 page, uint256 pageSize)
        internal
        view
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
