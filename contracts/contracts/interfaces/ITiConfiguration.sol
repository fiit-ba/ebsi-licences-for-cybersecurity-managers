pragma solidity 0.8.26;

import {Role, RoleSet} from "../libraries/Roles.sol";
import {ITiAccreditation} from "./ITiAccreditation.sol";

/**
 * @title ITiConfiguration
 * @notice Each TI's signers, cosigners, policies and proposal lifetime.
 */
interface ITiConfiguration is ITiAccreditation {
    event TiConfigured(bytes32 indexed tiId, string did, bytes32 attributeId, uint64 accreditedUntil);
    event TiAttributeChanged(bytes32 indexed tiId, bytes32 attributeId, uint64 accreditedUntil);
    /// @notice The TI's full cosigner list, at `addTi` and on every change. A
    ///         changed list ends the TI's open proposals.
    event CosignersChanged(bytes32 indexed tiId, Cosigner[] cosigners);

    event SignerAdded(bytes32 indexed tiId, address indexed signer, Role role);
    event SignerRemoved(bytes32 indexed tiId, address indexed signer, Role role);
    event SignerReplaced(bytes32 indexed tiId, address indexed previous, address indexed replacement, Role role);
    event PolicyChanged(
        bytes32 indexed tiId,
        PolicyKind indexed kind,
        uint8 threshold,
        RoleSet requiredRoleMask,
        RoleSet vetoRoleMask,
        uint64 timelock
    );
    event ProposalTtlChanged(bytes32 indexed tiId, uint64 ttl);

    /// @notice Set up a TI. TAO only; the TI must be its live accreditation
    ///         and every key valid for the TI's DID. `accreditedUntil`: no
    ///         later than the TAO's own.
    /// @return tiId `computeTiId(setup.did)`.
    function addTi(TiSetup calldata setup) external returns (bytes32 tiId);

    /// @notice Renew a TI, or follow it to a new attribute (a revoked one
    ///         never comes back), until a new future date.
    function setTiAttribute(bytes32 tiId, bytes32 attributeId, uint64 accreditedUntil) external;

    /// @notice Replace a TI's cosigners. TAO only; every policy stays reachable.
    function setCosigners(bytes32 tiId, Cosigner[] calldata cosigners) external;

    function computeTiId(string calldata did) external pure returns (bytes32);

    /// @notice Refuses an account that is not the TI's own key now, a cosigner's included.
    function requireOwnSigner(bytes32 tiId, address account) external view;

    /// @notice `requireOwnSigner`, and refuses a TI that is not active.
    function requireActiveOwnSigner(bytes32 tiId, address account) external view;

    /// @notice `isActiveTi`, and before `accreditedUntil`.
    function isAccredited(bytes32 tiId) external view returns (bool);

    /// @notice The role a key signs a TI's proposals with right now, as a
    ///         signer or for a cosigner's DID; 0 for none.
    function roleOf(bytes32 tiId, address account) external view returns (Role);

    /// @notice True for a TI's key that was removed or replaced.
    function retired(bytes32 tiId, address account) external view returns (bool);

    function isSigner(bytes32 tiId, address account) external view returns (bool);

    /// @notice Everything that decides a TI's proposals, in one read.
    function getTi(bytes32 tiId) external view returns (TiView memory);
}
