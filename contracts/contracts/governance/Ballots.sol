pragma solidity 0.8.26;

import {PolicyRules} from "../libraries/PolicyRules.sol";
import {Role, RoleSet} from "../libraries/Roles.sol";
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
        /// Lifetime end set at opening; may extend once approved (`_expiresAt`).
        uint64 expiresAt;
        /// The TI's epoch at opening. Fills free bytes: nothing moves.
        uint64 epoch;
        /// The TI's restorations at opening. Fills free bytes too.
        uint32 restorations;
        address[] signatures;
        mapping(address => bool) signed;
        /// The role each signature was given in. Last, to keep the layout.
        mapping(address => Role) signedAs;
    }

    function _open(Ballot storage ballot, bytes32 tiId) internal {
        ballot.tiId = tiId;
        ballot.proposer = msg.sender;
        ballot.proposedAt = uint64(block.timestamp);
        ballot.state = ProposalState.PROPOSED;
        ballot.expiresAt = uint64(block.timestamp) + _proposalTtl(tiId);
        ballot.epoch = _epoch(tiId);
        ballot.restorations = _restorations(tiId);
    }

    /// @dev Adds the caller's signature; returns the signed roles and
    ///      whether this completed the quorum. A lost quorum (key removed or
    ///      replaced, stricter policy) regained by a signature is a new
    ///      decision with the full veto delay (10.4). A signature is not the
    ///      only way back: see `_requireExecutable`.
    function _sign(Ballot storage ballot, Policy memory policy) internal returns (RoleSet signed, bool reached) {
        if (ballot.signed[msg.sender]) revert AlreadySigned();
        ballot.signed[msg.sender] = true;

        RoleSet before = _rolesSigned(ballot);
        Role role = roleOf(ballot.tiId, msg.sender);
        ballot.signatures.push(msg.sender);
        ballot.signedAs[msg.sender] = role;
        signed = before.with(role);

        reached = policy.meets(signed) && (ballot.state == ProposalState.PROPOSED || !policy.meets(before));
        if (reached) {
            ballot.quorumReachedAt = uint64(block.timestamp);
            ballot.state = ProposalState.APPROVED;
        }
    }

    /// @dev Who may stop an open proposal: a veto-role key; the proposer,
    ///      withdrawing its own; or any signer, once the proposer holds no role
    ///      and no quorum of live keys backs it - an orphan nobody else could
    ///      close. The caller holds a role either way (`_requireOpenToSigner`).
    function _cancel(Ballot storage ballot, Policy memory policy) internal {
        bytes32 tiId = ballot.tiId;
        if (
            msg.sender != ballot.proposer && !policy.vetoRoleMask.contains(roleOf(tiId, msg.sender))
                && (Role.unwrap(roleOf(tiId, ballot.proposer)) != 0 || policy.meets(_rolesSigned(ballot)))
        ) revert VetoNotAllowed();
        ballot.state = ProposalState.CANCELLED;
    }

    /// @dev Past its TTL, or `overtaken`: it could no longer change anything.
    function _expire(Ballot storage ballot, PolicyKind kind, bool overtaken) internal {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state)) revert ProposalNotOpen();
        if (!overtaken && !_lapsed(ballot, kind)) revert ProposalNotExpirable();
        ballot.state = ProposalState.EXPIRED;
    }

    /// @dev The ballot takes signatures and the caller is one of its signers.
    function _requireOpenToSigner(Ballot storage ballot, PolicyKind kind) internal view {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state) || _lapsed(ballot, kind)) revert ProposalNotOpen();
        _requireSigner(ballot.tiId);
    }

    /// @dev Quorum checked again with today's keys and policy. The timelock
    ///      runs from the quorum or a later loosening of its policy. A key the
    ///      DID Registry lists again returns unseen, on the original start.
    function _requireExecutable(Ballot storage ballot, PolicyKind kind) internal view {
        Policy memory policy = _policy(ballot.tiId, kind);
        if (ballot.state != ProposalState.APPROVED) revert QuorumNotReached();
        if (!policy.meets(_rolesSigned(ballot))) revert QuorumNotReached();
        uint64 executableAt = _timelockStartsAt(ballot, kind) + policy.timelock;
        if (block.timestamp < executableAt) revert TimelockNotElapsed(executableAt);
    }

    function _isOpen(ProposalState state) internal pure returns (bool) {
        return state == ProposalState.PROPOSED || state == ProposalState.APPROVED;
    }

    /// @dev Once approved, a day past `executableAt`, capped at MAX_PROPOSAL_TTL
    ///      from opening. 0: no end (opened before `expiresAt` existed).
    function _expiresAt(Ballot storage ballot, PolicyKind kind) internal view returns (uint64) {
        uint64 fixedEnd = ballot.expiresAt;
        if (fixedEnd == 0 || ballot.quorumReachedAt == 0) return fixedEnd;
        uint64 needed = _executableAt(ballot, kind) + MIN_SIGNING_WINDOW;
        uint64 cap = ballot.proposedAt + MAX_PROPOSAL_TTL;
        if (needed > cap) needed = cap;
        return needed > fixedEnd ? needed : fixedEnd;
    }

    function _pastTtl(Ballot storage ballot, PolicyKind kind) internal view returns (bool) {
        uint64 end = _expiresAt(ballot, kind);
        return end > 0 && block.timestamp >= end;
    }

    /// @dev Past its lifetime, or opened in an earlier epoch of the TI; a
    ///      restored accreditation ends reinstatements and rule changes.
    function _lapsed(Ballot storage ballot, PolicyKind kind) internal view returns (bool) {
        if (_pastTtl(ballot, kind) || ballot.epoch < _epoch(ballot.tiId)) return true;
        bool raises = kind == PolicyKind.REINSTATE || kind == PolicyKind.ADMIN;
        return raises && ballot.restorations < _restorations(ballot.tiId);
    }

    function _effectiveState(Ballot storage ballot, PolicyKind kind) internal view returns (ProposalState) {
        if (_isOpen(ballot.state) && _lapsed(ballot, kind)) return ProposalState.EXPIRED;
        return ballot.state;
    }

    function _executableAt(Ballot storage ballot, PolicyKind kind) internal view returns (uint64) {
        if (ballot.quorumReachedAt == 0) return 0;
        return _timelockStartsAt(ballot, kind) + _policy(ballot.tiId, kind).timelock;
    }

    /// @dev The quorum, or a later loosening of its policy.
    function _timelockStartsAt(Ballot storage ballot, PolicyKind kind) private view returns (uint64) {
        uint64 loosened = _loosenedAt(ballot.tiId, kind);
        return loosened > ballot.quorumReachedAt ? loosened : ballot.quorumReachedAt;
    }

    /// @dev Each signature in the role it was given in, while its key still
    ///      holds it. One from before roles were recorded: its key's role now.
    function _rolesSigned(Ballot storage ballot) internal view returns (RoleSet roles) {
        address[] storage signatures = ballot.signatures;
        for (uint256 i = 0; i < signatures.length; i++) {
            Role current = roleOf(ballot.tiId, signatures[i]);
            Role given = ballot.signedAs[signatures[i]];
            if (Role.unwrap(given) == 0 || Role.unwrap(given) == Role.unwrap(current)) roles = roles.with(current);
        }
    }
}
