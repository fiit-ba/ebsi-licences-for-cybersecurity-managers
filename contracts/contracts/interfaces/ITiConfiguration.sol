// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Role, RoleSet} from "../libraries/Roles.sol";
import {ITiAccreditation} from "./ITiAccreditation.sol";

/**
 * @title ITiConfiguration
 * @notice Each TI's signers, cosigners, policies and proposal lifetime.
 */
interface ITiConfiguration is ITiAccreditation {
    event TiConfigured(bytes32 indexed tiId, string did, bytes32 attributeId);
    event TiAttributeChanged(bytes32 indexed tiId, bytes32 attributeId);
    event CosignersChanged(bytes32 indexed tiId);

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
    ///         and every key valid for the TI's DID.
    /// @return tiId `computeTiId(setup.did)`.
    function addTi(TiSetup calldata setup) external returns (bytes32 tiId);

    /// @notice Follow a TI to a new accreditation. A revoked one never comes
    ///         back, so the TIR gives a re-accredited TI a new attribute.
    function setTiAttribute(bytes32 tiId, bytes32 attributeId) external;

    /// @notice Replace a TI's cosigners. TAO only; every policy stays reachable.
    function setCosigners(bytes32 tiId, Cosigner[] calldata cosigners) external;

    function computeTiId(string calldata did) external pure returns (bytes32);

    /// @notice Refuses an account that holds no role of the TI right now.
    function requireSigner(bytes32 tiId, address account) external view;

    /// @notice `requireSigner`, and refuses a TI that is not active.
    function requireActiveSigner(bytes32 tiId, address account) external view;

    function MAX_ROLE() external view returns (uint8);

    function MAX_TIMELOCK() external view returns (uint64);

    function MAX_PROPOSAL_TTL() external view returns (uint64);

    /// @notice The role a key signs a TI's proposals with right now, as a
    ///         signer or for a cosigner's DID; 0 for none.
    function roleOf(bytes32 tiId, address account) external view returns (Role);

    /// @notice True for a TI's key that was removed or replaced.
    function retired(bytes32 tiId, address account) external view returns (bool);

    function isSigner(bytes32 tiId, address account) external view returns (bool);

    function getPolicy(bytes32 tiId, PolicyKind kind) external view returns (Policy memory);

    /// @notice Everything that decides a TI's proposals, in one read.
    function getTi(bytes32 tiId) external view returns (TiView memory);
}
