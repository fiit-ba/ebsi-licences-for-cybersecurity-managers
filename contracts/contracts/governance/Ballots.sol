// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {PolicyRules} from "../libraries/PolicyRules.sol";
import {RoleSet} from "../libraries/Roles.sol";
import {TiConfiguration} from "./TiConfiguration.sol";

/**
 * @title Ballots
 * @notice What a status proposal and a rule change have in common: who
 *         opened it, when, who signed it, and where it stands. Signing,
 *         quorum, the timelock, the veto and expiry work the same way for both.
 */
abstract contract Ballots is TiConfiguration {
    using PolicyRules for Policy;

    struct Ballot {
        bytes32 tiId;
        address proposer;
        uint64 proposedAt;
        uint64 quorumReachedAt;
        ProposalState state;
        address[] signatures;
        mapping(address => bool) signed;
    }

    function _open(Ballot storage ballot, bytes32 tiId) internal {
        ballot.tiId = tiId;
        ballot.proposer = msg.sender;
        ballot.proposedAt = uint64(block.timestamp);
        ballot.state = ProposalState.PROPOSED;
    }

    /// @dev Adds the caller's signature; returns the signed roles and
    ///      whether this completed the quorum. The timelock restarts
    ///      whenever a lost quorum (key removed/replaced, stricter policy)
    ///      is regained: to the contract that's a new decision, and 10.4
    ///      gives every decision the full veto delay - otherwise a quorum
    ///      lost at t0+47h and regained at t0+47.5h would be near-unopposable
    ///      half an hour later. A signature is the only way a lost quorum
    ///      comes back (a removed key stays retired, never revives). A
    ///      policy relaxation is itself a rule-change decision and doesn't
    ///      restart this timelock.
    function _sign(Ballot storage ballot, Policy memory policy) internal returns (RoleSet signed, bool reached) {
        if (ballot.signed[msg.sender]) revert AlreadySigned();
        ballot.signed[msg.sender] = true;

        RoleSet before = _rolesSigned(ballot);
        ballot.signatures.push(msg.sender);
        signed = before.with(roleOf(ballot.tiId, msg.sender));

        reached = policy.meets(signed) && (ballot.state == ProposalState.PROPOSED || !policy.meets(before));
        if (reached) {
            ballot.quorumReachedAt = uint64(block.timestamp);
            ballot.state = ProposalState.APPROVED;
        }
    }

    /// @dev Who may stop an open proposal: a veto-role key, or the proposer
    ///      withdrawing their own. Withdrawal isn't a veto - it only stops
    ///      what the same key started, so a compromised key gains nothing
    ///      over simply not proposing, and the back-office needs it to close
    ///      a rejected case on-chain (D19) regardless of who holds the veto.
    function _cancel(Ballot storage ballot, Policy memory policy) internal {
        if (msg.sender != ballot.proposer && !policy.vetoRoleMask.contains(roleOf(ballot.tiId, msg.sender))) {
            revert VetoNotAllowed();
        }
        ballot.state = ProposalState.CANCELLED;
    }

    function _expire(Ballot storage ballot) internal {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state)) revert ProposalNotOpen();
        if (!_pastTtl(ballot)) revert ProposalNotExpirable();
        ballot.state = ProposalState.EXPIRED;
    }

    /// @dev The ballot takes signatures and the caller is one of its signers.
    function _requireOpenToSigner(Ballot storage ballot) internal view {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state) || _pastTtl(ballot)) revert ProposalNotOpen();
        _requireSigner(ballot.tiId);
    }

    /// @dev The quorum is checked again with today's signers and policy: a
    ///      signature whose key was removed no longer counts.
    function _requireExecutable(Ballot storage ballot, Policy memory policy) internal view {
        if (ballot.state != ProposalState.APPROVED) revert QuorumNotReached();
        if (!policy.meets(_rolesSigned(ballot))) revert QuorumNotReached();
        uint64 executableAt = ballot.quorumReachedAt + policy.timelock;
        if (block.timestamp < executableAt) revert TimelockNotElapsed(executableAt);
    }

    function _isOpen(ProposalState state) internal pure returns (bool) {
        return state == ProposalState.PROPOSED || state == ProposalState.APPROVED;
    }

    function _pastTtl(Ballot storage ballot) internal view returns (bool) {
        uint64 ttl = _proposalTtl(ballot.tiId);
        return ttl > 0 && block.timestamp >= ballot.proposedAt + ttl;
    }

    function _effectiveState(Ballot storage ballot) internal view returns (ProposalState) {
        if (_isOpen(ballot.state) && _pastTtl(ballot)) return ProposalState.EXPIRED;
        return ballot.state;
    }

    function _executableAt(Ballot storage ballot, Policy memory policy) internal view returns (uint64) {
        if (ballot.quorumReachedAt == 0) return 0;
        return ballot.quorumReachedAt + policy.timelock;
    }

    /// @dev The roles among a ballot's signatures whose keys still hold one.
    function _rolesSigned(Ballot storage ballot) internal view returns (RoleSet roles) {
        address[] storage signatures = ballot.signatures;
        for (uint256 i = 0; i < signatures.length; i++) {
            roles = roles.with(roleOf(ballot.tiId, signatures[i]));
        }
    }
}
