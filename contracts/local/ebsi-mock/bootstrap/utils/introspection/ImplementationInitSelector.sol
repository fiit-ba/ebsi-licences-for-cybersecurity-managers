// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import {IImplementationInitSelector} from "../../interfaces/IImplementationInitSelector.sol";

/**
 * @title ImplementationInitSelector
 * @notice ERC-165-aware base for beacon implementations that advertise their
 *         initializer selector via {IImplementationInitSelector}.
 * @dev Inherit this (or replicate the `supportsInterface` override) on every
 *      implementation registered behind a Contracts Registry beacon. Subclasses must implement
 *      {getImplementationInitSelector}, e.g. `return this.initialize.selector`.
 */
abstract contract ImplementationInitSelector is ERC165, IImplementationInitSelector {
    // bytes4(keccak256("getImplementationInitSelector()"))
    bytes4 public constant IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID = 0xf622b441;

    /**
     * @notice Returns true for IERC165 and {IImplementationInitSelector}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
}
