// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

/**
 * @title IContractsRegistryErrors
 * @notice Custom errors shared by {ProxyFactory} and {ProxyTemplatesRegistry}.
 * @dev Declared once here and inherited by both {IProxyFactory} and
 *      {IProxyTemplatesRegistry} so the same error name is never declared twice
 *      (which would be ambiguous for a contract inheriting both interfaces),
 *      while still appearing in the ABI of both contracts.
 */
interface IContractsRegistryErrors {
    // --- Errors ---
    error DefaultAdminCannotBeZero();
    error EbsiGovernorCannotBeZero();
    error PoliciesRegistryCannotBeZero();
    error PoliciesRegistryNotSet();
    error PoliciesRegistryNotAContract();
    error PageSizeTooLarge();
    error PageSizeZero();
    error PageZero();
}
