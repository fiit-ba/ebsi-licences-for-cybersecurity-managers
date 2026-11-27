pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {RoleSet} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// A decision keeps the timelock and the veto roles in force at its quorum:
/// a rule change applied later can make them stricter, never weaker.
contract DecisionKeepsItsPolicyTest is GovernanceTest {
    IGovernanceTypes.PolicyKind internal constant REVOKE = IGovernanceTypes.PolicyKind.REVOKE;
    IGovernanceTypes.PolicyKind internal constant ADMIN = IGovernanceTypes.PolicyKind.ADMIN;

    /// Audit: a loosening approved before a revocation took its timelock and
    /// C's veto once it applied, and the revocation executed at once.
    function test_ARuleChangeApprovedEarlierDoesNotWeakenALaterRevocation() public {
        (uint256 id, uint64 quorumAt) = _revocationBeforeALoosening(policy(2, NONE, only(ROLE_A), 0));

        assertEq(governance.getProposal(id).executableAt, quorumAt + DAY, "the 24 h still run");
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, quorumAt + DAY));
        governance.execute(id);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The timelock in force at the quorum runs out to the second.
    function test_TheHeldTimelockEndsExactly() public {
        (uint256 id, uint64 quorumAt) = _revocationBeforeALoosening(policy(2, NONE, ALL, 0));
        vm.warp(quorumAt + DAY - 1);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, quorumAt + DAY));
        governance.execute(id);
        vm.warp(quorumAt + DAY);
        execute(id, A);
    }

    /// A veto dropped later still holds, during the timelock and after it.
    function test_AVetoDroppedLaterStillHolds() public {
        (uint256 id, uint64 quorumAt) = _revocationBeforeALoosening(policy(2, NONE, only(ROLE_A), DAY));
        vm.warp(quorumAt + DAY);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A veto role added after the quorum may veto too: the stricter of both.
    function test_AVetoRoleAddedLaterMayVeto() public {
        governance = deploy(pilotWith(REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY)));
        uint256 id = _approveRevocation();
        applyAdmin(setPolicy(A, B, REVOKE, policy(2, NONE, ALL, DAY)));
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The same for a rule change: a looser rule-change policy applied later
    /// leaves C its veto on a rule change approved before.
    function test_ARuleChangeKeepsTheVetoInForceAtItsQuorum() public {
        RoleSet ab = both(ROLE_A, ROLE_B);
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint8 kind = 0; kind < 3; kind++) {
            policies[kind].vetoRoleMask = ab;
        }
        governance = deploy(policies);
        uint256 looser = setPolicy(A, B, ADMIN, policy(2, NONE, ab, DAY));
        skip(23 hours);
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        signAdmin(rule, B);
        skip(1 hours);
        executeAdmin(looser, A);

        // A narrower veto is a loosening: the delay restarts too, and ends later.
        assertEq(governance.getAdminProposal(rule).executableAt, vm.getBlockTimestamp() + DAY);
        cancelAdmin(rule, C);
        assertAdminState(rule, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A quorum regained under the looser policy keeps the stricter one held.
    function test_AQuorumRegainedUnderALooserPolicyKeepsWhatWasHeld() public {
        (uint256 id,) = _revocationBeforeALoosening(policy(2, NONE, only(ROLE_A), 0));
        _listForTheTi(B, false);
        sign(id, C);
        uint64 regainedAt = uint64(vm.getBlockTimestamp());

        assertEq(governance.getProposal(id).executableAt, regainedAt + DAY, "still 24 h");
        assertGe(governance.getProposal(id).expiresAt, regainedAt + 2 * DAY, "and a day to execute");
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, regainedAt + DAY));
        governance.execute(id);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The end a regained quorum stores counts the held timelock too: a later
    /// change, made past an end without it, leaves the decision executable.
    function test_ARegainedQuorumStoresAnEndPastTheHeldTimelock() public {
        IGovernanceTypes.Policy memory looser = policy(2, NONE, only(ROLE_A), 0);
        (uint256 id, uint64 quorumAt) = _revocationBeforeALoosening(looser);
        _listForTheTi(B, false);
        vm.warp(quorumAt + pilotTtl - DAY / 2);
        sign(id, C);
        uint64 regainedAt = uint64(vm.getBlockTimestamp());

        // The same policy again, applied a day after the regained quorum.
        applyAdmin(setPolicy(A, C, REVOKE, looser));
        assertEq(vm.getBlockTimestamp(), regainedAt + DAY);
        execute(id, A);
    }

    /// What the rule change is for: a decision whose quorum comes after it
    /// applies, even one opened before, follows the new policy. C stops that
    /// by vetoing the rule change during its own timelock.
    function test_AQuorumAfterTheChangeFollowsTheNewPolicy() public {
        uint256 looser = setPolicy(A, B, REVOKE, policy(2, NONE, only(ROLE_A), 0));
        skip(23 hours);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        skip(1 hours);
        executeAdmin(looser, A);
        sign(id, B);

        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp(), "no delay");
        vm.prank(C);
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        governance.cancelProposal(id, REASON);
        execute(id, A);
    }

    /// Both take bytes that were free: proposedAt's slot and restorations'.
    function test_WhatIsHeldTakesBytesThatWereFree() public {
        uint256 id = _approveRevocation();
        uint256 slot = _proposalSlot(id);
        uint256 opened = uint256(vm.load(address(governance), bytes32(slot + 4)));
        uint256 times = uint256(vm.load(address(governance), bytes32(slot + 5)));
        assertEq(address(uint160(opened)), A, "proposer stays");
        assertEq(uint64(opened >> 160), vm.getBlockTimestamp(), "proposedAt stays");
        assertEq(opened >> 224, DAY, "the timelock after it");
        assertEq(uint64(times), vm.getBlockTimestamp(), "quorumReachedAt stays");
        assertEq(uint8(times >> 232), RoleSet.unwrap(ALL), "the veto roles after restorations");
        assertEq(times >> 240, 0, "the rest stays free");
    }

    /// A loosening of REVOKE approved at once, a revocation approved 23 h
    /// later, the loosening applied an hour after that.
    function _revocationBeforeALoosening(IGovernanceTypes.Policy memory looser)
        private
        returns (uint256 id, uint64 quorumAt)
    {
        uint256 change = setPolicy(A, B, REVOKE, looser);
        skip(23 hours);
        id = _approveRevocation();
        quorumAt = uint64(vm.getBlockTimestamp());
        skip(1 hours);
        executeAdmin(change, A);
    }

    function _approveRevocation() private returns (uint256 id) {
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
    }

    function _listForTheTi(address key, bool listed) private {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, key, listed);
    }

    function _proposalSlot(uint256 id) private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(id, uint256(location) + 2)));
    }
}
