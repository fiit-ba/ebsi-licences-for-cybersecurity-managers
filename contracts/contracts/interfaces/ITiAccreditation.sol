pragma solidity 0.8.26;

import {IGovernanceTypes} from "./IGovernanceTypes.sol";

/**
 * @title ITiAccreditation
 * @notice The EBSI registries the contract trusts, and whether a TI is active.
 */
interface ITiAccreditation is IGovernanceTypes {
    /// @notice EBSI's DID Registry, set when the proxy is initialized and
    ///         never changed.
    function didRegistry() external view returns (address);

    /// @notice EBSI's Trusted Issuers Registry, set when the proxy is
    ///         initialized and never changed.
    function issuersRegistry() external view returns (address);

    /// @notice The DID of the TAO that accredits this contract's TIs.
    function taoDid() external view returns (string memory);

    /// @notice True while the attribute is a live TI accreditation by `taoDid`
    ///         with an unbroken path to a RootTAO.
    /// @param attributeId The TI's accreditation: the TIR keys it per attribute.
    function isActiveTi(string memory did, bytes32 attributeId) external view returns (bool);
}
