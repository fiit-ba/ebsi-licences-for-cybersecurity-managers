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
        /// When the lifetime set at opening ends. Fixed at opening: a later
        /// TTL change neither revives an expired ballot nor cuts an open one
        /// short.
        uint64 expiresAt;
        /// The TI's epoch at opening. Fills free bytes: nothing moves.
        uint64 epoch;
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

    /// @dev Who may stop an open proposal: a veto-role key, or the proposer
    ///      withdrawing their own. Withdrawal isn't a veto - it only stops
    ///      what the same key started, so a compromised key gains nothing
    ///      over simply not proposing, and the back-office needs it to close
    ///      a rejected case on-chain regardless of who holds the veto. Either
    ///      way the key must hold a role now (`_requireOpenToSigner`): a
    ///      removed, replaced or unlisted proposer withdraws nothing.
    function _cancel(Ballot storage ballot, Policy memory policy) internal {
        if (msg.sender != ballot.proposer && !policy.vetoRoleMask.contains(roleOf(ballot.tiId, msg.sender))) {
            revert VetoNotAllowed();
        }
        ballot.state = ProposalState.CANCELLED;
    }

    /// @dev Past its TTL, or `overtaken`: it could no longer change anything.
    function _expire(Ballot storage ballot, bool overtaken) internal {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state)) revert ProposalNotOpen();
        if (!overtaken && !_lapsed(ballot)) revert ProposalNotExpirable();
        ballot.state = ProposalState.EXPIRED;
    }

    /// @dev The ballot takes signatures and the caller is one of its signers.
    function _requireOpenToSigner(Ballot storage ballot) internal view {
        if (ballot.state == ProposalState.NONE) revert UnknownProposal();
        if (!_isOpen(ballot.state) || _lapsed(ballot)) revert ProposalNotOpen();
        _requireSigner(ballot.tiId);
    }

    /// @dev The quorum is checked again with today's signers and policy: a
    ///      signature whose key was removed no longer counts. The timelock
    ///      runs from the quorum or a later loosening of the policy, whichever
    ///      is later, for every decision of that kind, even one that never
    ///      lost its quorum; pushed past `expiresAt`, the decision expires and
    ///      is proposed again. A stricter policy or another rule change moves
    ///      nothing, and a cosigner change ends the ballot (`_lapsed`). A key
    ///      the DID Registry drops and lists again brings its signature back
    ///      unseen, and the quorum keeps its original start.
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

    /// @dev A ballot opened before `expiresAt` existed has none, and stays
    ///      open as it would have under a TTL of 0.
    function _pastTtl(Ballot storage ballot) internal view returns (bool) {
        return ballot.expiresAt > 0 && block.timestamp >= ballot.expiresAt;
    }

    /// @dev Past its TTL, or opened in an earlier epoch of the TI (before a
    ///      cosigner change or a restored accreditation).
    function _lapsed(Ballot storage ballot) internal view returns (bool) {
        return _pastTtl(ballot) || ballot.epoch < _epoch(ballot.tiId);
    }

    function _effectiveState(Ballot storage ballot) internal view returns (ProposalState) {
        if (_isOpen(ballot.state) && _lapsed(ballot)) return ProposalState.EXPIRED;
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
