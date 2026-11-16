// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title IImplementationInitSelector
 * @notice Implementations behind Contracts Registry beacons expose their current initializer
 *         selector so ProxyFactory can resolve it at deploy time (not from a
 *         stale template field).
 * @dev ERC-165 interface id is `0xf622b441`
 *      (= `bytes4(keccak256("getImplementationInitSelector()"))`).
 */
interface IImplementationInitSelector {
    /**
     * @notice Returns the function selector used to initialize proxies of this
     *         implementation (typically `this.initialize.selector`).
     */
    function getImplementationInitSelector() external view returns (bytes4);
}
