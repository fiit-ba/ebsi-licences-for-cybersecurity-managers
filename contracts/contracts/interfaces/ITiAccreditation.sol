// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IGovernanceTypes} from "./IGovernanceTypes.sol";

/**
 * @title ITiAccreditation
 * @notice The EBSI registries the contract trusts, and whether a TI is active.
 */
interface ITiAccreditation is IGovernanceTypes {
    event RegistriesChanged(address didRegistry, address issuersRegistry);

    /// @notice EBSI's DID Registry.
    function didRegistry() external view returns (address);

    /// @notice EBSI's Trusted Issuers Registry.
    function issuersRegistry() external view returns (address);

    /// @notice Point the contract at other registries. TAO only, at once; the
    ///         TAO's key must be valid in the new DID Registry.
    function setRegistries(address didRegistry_, address issuersRegistry_) external;

    /// @notice The DID of the TAO that accredits this contract's TIs.
    function taoDid() external view returns (string memory);

    /// @notice True while the attribute is a live TI accreditation by `taoDid`
    ///         with an unbroken path to a RootTAO.
    /// @param attributeId The TI's accreditation: the TIR keys it per attribute.
    function isActiveTi(string memory did, bytes32 attributeId) external view returns (bool);
}
