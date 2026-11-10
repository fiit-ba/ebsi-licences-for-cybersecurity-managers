// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Role, RoleSet} from "../libraries/Roles.sol";
import {IGovernanceTypes} from "./IGovernanceTypes.sol";

/**
 * @title IStatusProposals
 * @notice Proposals to suspend, revoke or reinstate a certificate (component
 *         10.5), and their audit verification (component 10.7).
 */
interface IStatusProposals is IGovernanceTypes {
    event CertificateRegistryChanged(address certificateRegistry);

    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 tiId,
        bytes32 indexed statusKey,
        ActionType actionType,
        bytes32 reasonHash,
        address indexed proposer
    );
    event ProposalSigned(uint256 indexed proposalId, address indexed signer, Role role, RoleSet rolesSignedMask);
    /// @notice Emitted when a proposal reaches its quorum, and again when it
    ///         regains a quorum it had lost; `executableAt` restarts then.
    event QuorumReached(uint256 indexed proposalId, uint64 executableAt);
    event ProposalExecuted(uint256 indexed proposalId, bytes32 indexed statusKey, ActionType actionType);
    /// @param reasonHash A digest of the off-chain record of why, or zero.
    event ProposalCancelled(
        uint256 indexed proposalId, bytes32 indexed statusKey, address indexed by, bytes32 reasonHash
    );
    event ProposalExpired(uint256 indexed proposalId, bytes32 indexed statusKey);

    /// @notice The registry executed proposals take effect in.
    function certificateRegistry() external view returns (address);

    /// @notice Point the contract at a certificate registry. TAO only.
    function setCertificateRegistry(address certificateRegistry_) external;

    /// @notice Open a proposal and cast the proposer's signature.
    /// @param statusKey The certificate's record in the registry, which must
    ///        be the TI's own (D42).
    /// @param reasonHash The reason's commitment (DECISIONS.md D22): see
    ///        `computeReasonHash`. Required for a suspension and a revocation.
    function proposeAction(bytes32 tiId, bytes32 statusKey, ActionType actionType, bytes32 reasonHash)
        external
        returns (uint256 proposalId);

    /// @notice Add a signature to an open proposal.
    function signProposal(uint256 proposalId) external;

    /// @notice Execute a proposal whose quorum, and timelock if any, are met.
    function execute(uint256 proposalId) external;

    /// @notice Veto an open proposal, or withdraw one the caller opened.
    /// @param reasonHash A digest of the off-chain record of why, or zero.
    ///        Never the hash of a reason alone: a reason code has few
    ///        values, and its hash would publish it (component 10.3).
    function cancelProposal(uint256 proposalId, bytes32 reasonHash) external;

    /// @notice Mark a proposal past its time to live expired, so its
    ///         certificate can be proposed for again. Anyone may call it.
    function expireProposal(uint256 proposalId) external;

    // -----------------------------------------------------------------------
    // Audit verification (component 10.7)
    // -----------------------------------------------------------------------

    /// @notice The commitment of a status change's reason, from its pre-image:
    ///         the reason's category, its note and a salt of the proposal's own.
    function computeReasonHash(string calldata reasonCode, string calldata reasonNote, bytes32 salt)
        external
        pure
        returns (bytes32);

    /// @notice True when the proposal was opened with exactly this reason.
    function verifyProposalReason(
        uint256 proposalId,
        string calldata reasonCode,
        string calldata reasonNote,
        bytes32 salt
    ) external view returns (bool);

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function proposalCount() external view returns (uint256);

    function getProposal(uint256 proposalId) external view returns (ProposalView memory);

    function hasSigned(uint256 proposalId, address account) external view returns (bool);

    function signatureCount(uint256 proposalId) external view returns (uint256);

    /// @notice The open proposal for a certificate, or 0.
    function openProposalFor(bytes32 statusKey) external view returns (uint256);

    /// @notice State as of now: EXPIRED for a proposal past its time to live,
    ///         even before anyone has called `expireProposal`.
    function stateOf(uint256 proposalId) external view returns (ProposalState);
}
