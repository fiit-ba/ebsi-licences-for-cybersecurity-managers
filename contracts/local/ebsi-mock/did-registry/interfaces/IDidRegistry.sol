// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title Interface DID Registry to check controllers
 */
interface IDidRegistry {
    function checkController(bytes calldata identifier, address ctrl) external view returns (bool);
}
