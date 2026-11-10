// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../../bootstrap/utils/Pagination.sol";

library CustomPagination {
    /* Paginate Ids based on the number of Ids.
        Id is incremental, the first index is 1.
        Self corresponds to the total number of ids   */
    function paginate(uint256 self, uint256 page, uint256 pageSize)
        internal
        pure
        returns (uint256[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256 cursor;
        (cursor, howMany, prev, next) = Pagination.getPaginationParameters(self, page, pageSize);
        items = new uint256[](howMany);
        if (howMany > 0) {
            for (uint256 i = 0; i < howMany; i++) {
                items[i] = cursor + i + 1;
            }
        }

        return (items, self, howMany, prev, next);
    }
}
