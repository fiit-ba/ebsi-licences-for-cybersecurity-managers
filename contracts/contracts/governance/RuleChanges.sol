// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IRuleChanges} from "../interfaces/IRuleChanges.sol";
import {Role, RoleSet} from "../libraries/Roles.sol";
import {Ballots} from "./Ballots.sol";

/**
 * @title RuleChanges
 * @notice Self-administration (component 10.4): the contract changes its own
 *         signers, policies and proposal lifetime only through a quorum of its
 *         own, under the ADMIN policy. No single administrator can add a
 *         signer, lower a threshold or shorten a timelock alone.
 *
 * @dev Each change is its own function, so a signer's wallet shows what it is
 *      being asked to approve by name.
 */
abstract contract RuleChanges is IRuleChanges, Ballots {
    struct AdminProposal {
        AdminChange change;
        Ballot ballot;
    }

    /// @custom:storage-location erc7201:plr.storage.RuleChanges
    struct RuleChangesStorage {
        uint256 adminProposalCount;
        mapping(uint256 => AdminProposal) adminProposals;
    }

    /// @dev `cast index-erc7201 plr.storage.RuleChanges`
    bytes32 private constant RULE_CHANGES_STORAGE = 0x3468fd24d8755a5f99c66e20e42422b45f3e5d5228e6589834ba2c0c36fb1800;

    function _ruleChangesStorage() private pure returns (RuleChangesStorage storage $) {
        assembly ("memory-safe") {
            $.slot := RULE_CHANGES_STORAGE
        }
    }

    function proposeAddSigner(bytes32 tiId, address signer, Role role) external returns (uint256) {
        AdminChange memory change;
        change.action = AdminAction.ADD_SIGNER;
        change.subject = signer;
        change.role = role;
        return _proposeAdmin(tiId, change);
    }

    function proposeRemoveSigner(bytes32 tiId, address signer) external returns (uint256) {
        AdminChange memory change;
        change.action = AdminAction.REMOVE_SIGNER;
        change.subject = signer;
        return _proposeAdmin(tiId, change);
    }

    function proposeReplaceSigner(bytes32 tiId, address signer, address replacement) external returns (uint256) {
        AdminChange memory change;
        change.action = AdminAction.REPLACE_SIGNER;
        change.subject = signer;
        change.replacement = replacement;
        return _proposeAdmin(tiId, change);
    }

    function proposePolicy(
        bytes32 tiId,
        PolicyKind kind,
        uint8 threshold,
        RoleSet requiredRoleMask,
        RoleSet vetoRoleMask,
        uint64 timelock
    ) external returns (uint256) {
        AdminChange memory change;
        change.action = AdminAction.SET_POLICY;
        change.kind = kind;
        change.policy = Policy(threshold, requiredRoleMask, vetoRoleMask, timelock);
        return _proposeAdmin(tiId, change);
    }

    function proposeProposalTtl(bytes32 tiId, uint64 ttl) external returns (uint256) {
        AdminChange memory change;
        change.action = AdminAction.SET_PROPOSAL_TTL;
        change.ttl = ttl;
        return _proposeAdmin(tiId, change);
    }

    function signAdminProposal(uint256 adminProposalId) external {
        _signAdmin(adminProposalId, _openAdmin(adminProposalId));
    }

    function executeAdminProposal(uint256 adminProposalId) external {
        AdminProposal storage p = _openAdmin(adminProposalId);
        _requireExecutable(p.ballot, _adminPolicy(p.ballot.tiId));
        _executeAdmin(adminProposalId, p);
    }

    /// @dev Vetoed by ADMIN's roles, or withdrawn by the proposer - except by
    ///      the key being removed/replaced: a compromised key can't block
    ///      its own removal (needed for rotation, component 10.9). A second
    ///      key of that role can still veto.
    function cancelAdminProposal(uint256 adminProposalId) external {
        AdminProposal storage p = _openAdmin(adminProposalId);
        AdminAction action = p.change.action;
        if (
            (action == AdminAction.REMOVE_SIGNER || action == AdminAction.REPLACE_SIGNER)
                && p.change.subject == msg.sender
        ) revert CannotVetoOwnRemoval();
        _cancel(p.ballot, _adminPolicy(p.ballot.tiId));
        emit AdminProposalCancelled(adminProposalId, msg.sender);
    }

    function expireAdminProposal(uint256 adminProposalId) external {
        _expire(_ruleChangesStorage().adminProposals[adminProposalId].ballot);
        emit AdminProposalExpired(adminProposalId);
    }

    function adminProposalCount() external view returns (uint256) {
        return _ruleChangesStorage().adminProposalCount;
    }

    function getAdminProposal(uint256 adminProposalId) external view returns (AdminProposalView memory result) {
        AdminProposal storage p = _ruleChangesStorage().adminProposals[adminProposalId];
        if (p.ballot.state == ProposalState.NONE) revert UnknownProposal();
        result.tiId = p.ballot.tiId;
        result.change = p.change;
        result.proposedAt = p.ballot.proposedAt;
        result.quorumReachedAt = p.ballot.quorumReachedAt;
        result.state = _effectiveState(p.ballot);
        result.signatures = p.ballot.signatures;
        result.executableAt = _executableAt(p.ballot, _adminPolicy(p.ballot.tiId));
        result.rolesSignedMask = _rolesSigned(p.ballot);
        result.proposer = p.ballot.proposer;
    }

    function hasSignedAdmin(uint256 adminProposalId, address account) external view returns (bool) {
        return _ruleChangesStorage().adminProposals[adminProposalId].ballot.signed[account];
    }

    function adminStateOf(uint256 adminProposalId) external view returns (ProposalState) {
        return _effectiveState(_ruleChangesStorage().adminProposals[adminProposalId].ballot);
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    function _proposeAdmin(bytes32 tiId, AdminChange memory change) private returns (uint256 adminProposalId) {
        requireActiveSigner(tiId, msg.sender);
        _requireValid(tiId, change);
        RuleChangesStorage storage $ = _ruleChangesStorage();
        adminProposalId = ++$.adminProposalCount;
        AdminProposal storage p = $.adminProposals[adminProposalId];
        p.change = change;
        _open(p.ballot, tiId);
        emit AdminProposalCreated(adminProposalId, tiId, change.action, msg.sender);
        _signAdmin(adminProposalId, p);
    }

    function _signAdmin(uint256 adminProposalId, AdminProposal storage p) private {
        Policy memory policy = _adminPolicy(p.ballot.tiId);
        (RoleSet signed, bool reached) = _sign(p.ballot, policy);
        emit AdminProposalSigned(adminProposalId, msg.sender, roleOf(p.ballot.tiId, msg.sender), signed);
        if (reached) {
            emit AdminQuorumReached(adminProposalId, p.ballot.quorumReachedAt + policy.timelock);
            // Without a delay the change applies with the signature that
            // completes its quorum, as it always has.
            if (policy.timelock == 0) _executeAdmin(adminProposalId, p);
        }
    }

    function _executeAdmin(uint256 adminProposalId, AdminProposal storage p) private {
        AdminChange memory change = p.change;
        bytes32 tiId = p.ballot.tiId;
        _requireActive(tiId);
        // The configuration may have moved since the change was proposed.
        _requireValid(tiId, change);
        p.ballot.state = ProposalState.EXECUTED;
        _apply(tiId, change);
        _bumpVersion(tiId);
        emit AdminProposalExecuted(adminProposalId, change.action);
    }

    function _openAdmin(uint256 adminProposalId) private view returns (AdminProposal storage p) {
        p = _ruleChangesStorage().adminProposals[adminProposalId];
        _requireOpenToSigner(p.ballot);
    }

    function _adminPolicy(bytes32 tiId) private view returns (Policy memory) {
        return _policy(tiId, PolicyKind.ADMIN);
    }

    /// @dev A change is valid if applying it now leaves every policy reachable.
    function _requireValid(bytes32 tiId, AdminChange memory change) private view {
        AdminAction action = change.action;
        if (action == AdminAction.ADD_SIGNER) {
            _requireNewSigner(tiId, change.subject, change.role);
        } else if (action == AdminAction.REMOVE_SIGNER) {
            if (Role.unwrap(_signerRole(tiId, change.subject)) == 0) revert InvalidSigner();
            _requireReachable(tiId, _rolesPresentExcluding(tiId, change.subject));
        } else if (action == AdminAction.REPLACE_SIGNER) {
            if (Role.unwrap(_signerRole(tiId, change.subject)) == 0) revert InvalidSigner();
            _requireNewSigner(tiId, change.replacement, _signerRole(tiId, change.subject));
        } else if (action == AdminAction.SET_POLICY) {
            _requirePolicy(change.policy, _rolesPresent(tiId));
        } else {
            // SET_PROPOSAL_TTL
            _requireTtl(change.ttl);
        }
    }

    function _apply(bytes32 tiId, AdminChange memory change) private {
        AdminAction action = change.action;
        if (action == AdminAction.ADD_SIGNER) {
            _addSigner(tiId, change.subject, change.role);
        } else if (action == AdminAction.REMOVE_SIGNER) {
            Role role = _signerRole(tiId, change.subject);
            _dropSigner(tiId, change.subject);
            emit SignerRemoved(tiId, change.subject, role);
        } else if (action == AdminAction.REPLACE_SIGNER) {
            Role role = _replaceSigner(tiId, change.subject, change.replacement);
            emit SignerReplaced(tiId, change.subject, change.replacement, role);
        } else if (action == AdminAction.SET_POLICY) {
            _setPolicy(tiId, change.kind, change.policy);
        } else {
            // SET_PROPOSAL_TTL
            _setProposalTtl(tiId, change.ttl);
        }
    }
}
