// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {ICertificateRegistry} from "../interfaces/ICertificateRegistry.sol";
import {IStatusProposals} from "../interfaces/IStatusProposals.sol";
import {Hashes} from "../libraries/Hashes.sol";
import {PolicyRules} from "../libraries/PolicyRules.sol";
import {RoleSet} from "../libraries/Roles.sol";
import {Ballots} from "./Ballots.sol";

/**
 * @title StatusProposals
 * @notice Proposals to suspend, revoke or reinstate a certificate (component
 *         10.5), and their audit verification (component 10.7). An executed
 *         proposal sets the certificate's standing in the registry (D30, D39).
 */
abstract contract StatusProposals is IStatusProposals, Ballots {
    using PolicyRules for ActionType;

    /// @notice A status change proposal: the certificate's record (D42), and
    ///         the commitment of its reason (DECISIONS.md D22).
    struct Proposal {
        bytes32 statusKey;
        ActionType actionType;
        bytes32 reasonHash;
        Ballot ballot;
    }

    /// @custom:storage-location erc7201:plr.storage.StatusProposals
    struct StatusProposalsStorage {
        address certificateRegistry;
        uint256 proposalCount;
        mapping(uint256 => Proposal) proposals;
        /// @dev One open proposal per certificate, so two operators cannot
        ///      race it into contradictory states, and a suspension and a
        ///      revocation of it are never open at once.
        mapping(bytes32 => uint256) openProposalFor;
    }

    /// @dev `cast index-erc7201 plr.storage.StatusProposals`
    bytes32 private constant STATUS_PROPOSALS_STORAGE =
        0x657e67b15ada4483275e73bbe252835d71cb6d102dac939a2f95605483077b00;

    function _statusProposalsStorage() private pure returns (StatusProposalsStorage storage $) {
        assembly ("memory-safe") {
            $.slot := STATUS_PROPOSALS_STORAGE
        }
    }

    function setCertificateRegistry(address certificateRegistry_) external onlyTao {
        _setCertificateRegistry(certificateRegistry_);
    }

    function _setCertificateRegistry(address certificateRegistry_) internal {
        if (certificateRegistry_.code.length == 0) revert InvalidRegistry();
        _statusProposalsStorage().certificateRegistry = certificateRegistry_;
        emit CertificateRegistryChanged(certificateRegistry_);
    }

    /// @dev Signatures are aggregated on-chain, not collected off-chain and
    ///      submitted together (10.4), so each is independently attributable
    ///      and timestamped. A proposal for the same certificate past its TTL
    ///      is expired here instead of blocking the new one. The reason travels
    ///      as a salted commitment (`computeReasonHash`, 10.3): fixed once
    ///      signed, unreadable on-chain; checked later via
    ///      `verifyProposalReason`. Nothing is proposed for a revoked
    ///      certificate; any other standing admits any action.
    function proposeAction(bytes32 tiId, bytes32 statusKey, ActionType actionType, bytes32 reasonHash)
        external
        returns (uint256 proposalId)
    {
        requireActiveSigner(tiId, msg.sender);
        if (reasonHash == bytes32(0) && actionType != ActionType.REINSTATE) revert ReasonRequired();
        _certificateRegistry().requireChangeableBy(statusKey, tiId);

        StatusProposalsStorage storage $ = _statusProposalsStorage();
        uint256 existing = $.openProposalFor[statusKey];
        if (existing != 0) {
            Ballot storage previous = $.proposals[existing].ballot;
            if (_isOpen(previous.state)) {
                if (!_pastTtl(previous)) revert ProposalAlreadyOpen(existing);
                previous.state = ProposalState.EXPIRED;
                emit ProposalExpired(existing, statusKey);
            }
        }

        proposalId = ++$.proposalCount;
        Proposal storage p = $.proposals[proposalId];
        p.statusKey = statusKey;
        p.actionType = actionType;
        p.reasonHash = reasonHash;
        _open(p.ballot, tiId);
        $.openProposalFor[statusKey] = proposalId;

        emit ProposalCreated(proposalId, tiId, statusKey, actionType, reasonHash, msg.sender);
        _signProposal(proposalId, p);
    }

    function signProposal(uint256 proposalId) external {
        _signProposal(proposalId, _openProposal(proposalId));
    }

    /// @dev Sets the certificate's standing (D30): SUSPENDED, REVOKED (for
    ///      good), or VALID again. This is what a verifier reads (D36); the
    ///      back-office catches up via `ProposalExecuted`.
    function execute(uint256 proposalId) external {
        Proposal storage p = _openProposal(proposalId);
        bytes32 tiId = p.ballot.tiId;
        _requireActive(tiId);
        _requireExecutable(p.ballot, _policy(tiId, p.actionType.policyKind()));

        p.ballot.state = ProposalState.EXECUTED;
        delete _statusProposalsStorage().openProposalFor[p.statusKey];

        emit ProposalExecuted(proposalId, p.statusKey, p.actionType);
        _certificateRegistry().applyExecuted(tiId, p.statusKey, p.actionType, proposalId, p.reasonHash, msg.sender);
    }

    /// @dev Single-signer veto, not a quorum action: a timelock nobody can
    ///      interrupt alone protects against neither a rash nor a
    ///      compromised decision (10.4) - requiring a quorum to cancel would
    ///      hand a 2-of-3 attacker the veto too. `vetoRoleMask` names which
    ///      roles hold it; the proposer may always withdraw. Deliberately
    ///      asymmetric: approving is hard, stopping is easy, since a wrongly
    ///      executed revocation is terminal (component 1.1) but a wrongly
    ///      cancelled proposal can be reopened.
    function cancelProposal(uint256 proposalId, bytes32 reasonHash) external {
        Proposal storage p = _openProposal(proposalId);
        _cancel(p.ballot, _policy(p.ballot.tiId, p.actionType.policyKind()));
        delete _statusProposalsStorage().openProposalFor[p.statusKey];
        emit ProposalCancelled(proposalId, p.statusKey, msg.sender, reasonHash);
    }

    /// @dev Permissionless: expiry is a mechanical consequence of the clock,
    ///      not a decision, and leaving it to signers would let a certificate
    ///      stay blocked indefinitely.
    function expireProposal(uint256 proposalId) external {
        StatusProposalsStorage storage $ = _statusProposalsStorage();
        Proposal storage p = $.proposals[proposalId];
        _expire(p.ballot);
        delete $.openProposalFor[p.statusKey];
        emit ProposalExpired(proposalId, p.statusKey);
    }

    // -----------------------------------------------------------------------
    // Audit verification (component 10.7)
    // -----------------------------------------------------------------------

    /// @dev Audit step 2-3: the auditor computes the key from the TI and the
    ///      id (`computeStatusKey`), compares it with the proposal's, and
    ///      reads the registry's `certificateStatus` to confirm the executed
    ///      action stuck. The reason's pre-image comes from the back-office,
    ///      which records every disclosure (DECISIONS.md D22).
    function computeReasonHash(string calldata reasonCode, string calldata reasonNote, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return Hashes.reason(reasonCode, reasonNote, salt);
    }

    function verifyProposalReason(
        uint256 proposalId,
        string calldata reasonCode,
        string calldata reasonNote,
        bytes32 salt
    ) external view returns (bool) {
        bytes32 committed = _statusProposalsStorage().proposals[proposalId].reasonHash;
        return committed != bytes32(0) && committed == computeReasonHash(reasonCode, reasonNote, salt);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function certificateRegistry() public view returns (address) {
        return _statusProposalsStorage().certificateRegistry;
    }

    function proposalCount() external view returns (uint256) {
        return _statusProposalsStorage().proposalCount;
    }

    function hasSigned(uint256 proposalId, address account) external view returns (bool) {
        return _statusProposalsStorage().proposals[proposalId].ballot.signed[account];
    }

    function openProposalFor(bytes32 statusKey) external view returns (uint256) {
        return _statusProposalsStorage().openProposalFor[statusKey];
    }

    function getProposal(uint256 proposalId) external view returns (ProposalView memory result) {
        Proposal storage p = _statusProposalsStorage().proposals[proposalId];
        if (p.ballot.state == ProposalState.NONE) revert UnknownProposal();
        Policy memory policy = _policy(p.ballot.tiId, p.actionType.policyKind());
        result.tiId = p.ballot.tiId;
        result.statusKey = p.statusKey;
        result.actionType = p.actionType;
        result.reasonHash = p.reasonHash;
        result.proposedAt = p.ballot.proposedAt;
        result.quorumReachedAt = p.ballot.quorumReachedAt;
        result.state = _effectiveState(p.ballot);
        result.signatures = p.ballot.signatures;
        result.executableAt = _executableAt(p.ballot, policy);
        result.rolesSignedMask = _rolesSigned(p.ballot);
        result.proposer = p.ballot.proposer;
    }

    function signatureCount(uint256 proposalId) external view returns (uint256) {
        return _statusProposalsStorage().proposals[proposalId].ballot.signatures.length;
    }

    function stateOf(uint256 proposalId) external view returns (ProposalState) {
        return _effectiveState(_statusProposalsStorage().proposals[proposalId].ballot);
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    function _certificateRegistry() private view returns (ICertificateRegistry) {
        return ICertificateRegistry(certificateRegistry());
    }

    function _signProposal(uint256 proposalId, Proposal storage p) private {
        Policy memory policy = _policy(p.ballot.tiId, p.actionType.policyKind());
        (RoleSet signed, bool reached) = _sign(p.ballot, policy);
        emit ProposalSigned(proposalId, msg.sender, roleOf(p.ballot.tiId, msg.sender), signed);
        // Suspension and reinstatement can be executed as soon as quorum is
        // reached; a permanent revocation waits out its timelock (10.4).
        if (reached) emit QuorumReached(proposalId, p.ballot.quorumReachedAt + policy.timelock);
    }

    function _openProposal(uint256 proposalId) private view returns (Proposal storage p) {
        p = _statusProposalsStorage().proposals[proposalId];
        _requireOpenToSigner(p.ballot);
    }
}
