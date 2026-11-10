// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

library UtilsLib {
    function equalStrings(string memory a, string memory b) internal pure returns (bool) {
        bytes memory aBytes = abi.encodePacked(a);
        bytes memory bBytes = abi.encodePacked(b);
        if (aBytes.length != bBytes.length) {
            return false;
        }
        return keccak256(aBytes) == keccak256(bBytes);
    }
}
