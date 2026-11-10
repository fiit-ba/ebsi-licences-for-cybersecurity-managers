// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "@openzeppelin/contracts/utils/Strings.sol";

library StringManip {
    function convertToString(address account) public pure returns (string memory) {
        return Strings.toHexString(account);
    }
}
