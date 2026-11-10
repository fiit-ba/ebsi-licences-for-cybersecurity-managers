// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Role, RoleSet} from "../libraries/Roles.sol";
import {IGovernanceTypes} from "./IGovernanceTypes.sol";

/**
 * @title IRuleChanges
 * @notice Self-administration (component 10.4): a TI's quorum changing its
 *         own signers, policies and proposal lifetime.
 */
interface IRuleChanges is IGovernanceTypes {
    event AdminProposalCreated(
        uint256 indexed adminProposalId, bytes32 indexed tiId, AdminAction action, address indexed proposer
    );
    event AdminProposalSigned(
        uint256 indexed adminProposalId, address indexed signer, Role role, RoleSet rolesSignedMask
    );
    event AdminQuorumReached(uint256 indexed adminProposalId, uint64 executableAt);
    event AdminProposalExecuted(uint256 indexed adminProposalId, AdminAction action);
    event AdminProposalCancelled(uint256 indexed adminProposalId, address indexed by);
    event AdminProposalExpired(uint256 indexed adminProposalId);

    function proposeAddSigner(bytes32 tiId, address signer, Role role) external returns (uint256);

    function proposeRemoveSigner(bytes32 tiId, address signer) external returns (uint256);

    /// @notice Replace a signer key with a new one of the same role: a key
    ///         rotation, in one step, that never changes who can reach quorum.
    function proposeReplaceSigner(bytes32 tiId, address signer, address replacement) external returns (uint256);

    function proposePolicy(
        bytes32 tiId,
        PolicyKind kind,
        uint8 threshold,
        RoleSet requiredRoleMask,
        RoleSet vetoRoleMask,
        uint64 timelock
    ) external returns (uint256);

    function proposeProposalTtl(bytes32 tiId, uint64 ttl) external returns (uint256);

    function signAdminProposal(uint256 adminProposalId) external;

    function executeAdminProposal(uint256 adminProposalId) external;

    /// @notice Veto an open rule change, or withdraw one the caller opened -
    ///         except a change that removes or replaces the caller's own key.
    function cancelAdminProposal(uint256 adminProposalId) external;

    function expireAdminProposal(uint256 adminProposalId) external;

    function adminProposalCount() external view returns (uint256);

    function getAdminProposal(uint256 adminProposalId) external view returns (AdminProposalView memory);

    function hasSignedAdmin(uint256 adminProposalId, address account) external view returns (bool);

    function adminStateOf(uint256 adminProposalId) external view returns (ProposalState);
}
