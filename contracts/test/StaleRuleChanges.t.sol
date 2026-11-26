pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IRuleChanges} from "../contracts/interfaces/IRuleChanges.sol";
import {RoleSet} from "../contracts/libraries/Roles.sol";

/// A rule change opened before a later one set the same policy, or the
/// lifetime, is overtaken: it reads EXPIRED and can no longer be applied.
contract StaleRuleChangesTest is GovernanceTest {
    IGovernanceTypes.PolicyKind internal constant SUSPEND = IGovernanceTypes.PolicyKind.SUSPEND;
    IGovernanceTypes.PolicyKind internal constant REVOKE = IGovernanceTypes.PolicyKind.REVOKE;

    /// Audit: a neutral change, approved and left alone, undid a later
    /// tightening when one key executed it.
    function test_AStaleNeutralChangeCannotUndoALaterTightening() public {
        uint256 stale = setPolicy(A, B, REVOKE, pilot[uint8(REVOKE)]);
        assertAdminState(stale, IGovernanceTypes.ProposalState.APPROVED);
        skip(HOUR);
        applyAdmin(setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY)));

        assertAdminState(stale, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.executeAdminProposal(stale);
        assertEq(RoleSet.unwrap(governance.getPolicy(TI_ID, REVOKE).requiredRoleMask), RoleSet.unwrap(only(ROLE_C)));

        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminProposalExpired(stale);
        vm.prank(outsider);
        governance.expireAdminProposal(stale);
        assertEq(uint8(governance.getAdminProposal(stale).state), uint8(IGovernanceTypes.ProposalState.EXPIRED));
    }

    /// The same for the proposal lifetime.
    function test_AStaleLifetimeChangeCannotUndoALaterOne() public {
        uint256 stale = setTtl(A, B, pilotTtl + DAY);
        skip(HOUR);
        applyAdmin(setTtl(A, B, pilotTtl + 2 * DAY));

        assertAdminState(stale, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.executeAdminProposal(stale);
        assertEq(governance.getTi(TI_ID).proposalTtl, pilotTtl + 2 * DAY);
    }

    /// An overtaken change takes no signature and no veto; anyone expires it, once.
    function test_AnOvertakenChangeIsClosedOnlyByExpiry() public {
        vm.prank(A);
        uint256 stale = governance.proposePolicy(TI_ID, REVOKE, 2, NONE, ALL, DAY);
        skip(HOUR);
        applyAdmin(setPolicy(B, C, REVOKE, policy(2, only(ROLE_C), ALL, DAY)));

        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signAdminProposal(stale);
        vm.prank(C);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.cancelAdminProposal(stale);

        vm.prank(outsider);
        governance.expireAdminProposal(stale);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.expireAdminProposal(stale);
    }

    /// Only the same rule overtakes: another policy, or the lifetime, does not.
    function test_AChangeOfAnotherRuleOvertakesNothing() public {
        uint256 revoke = setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        uint256 ttl = setTtl(A, B, pilotTtl + DAY);
        skip(HOUR);
        applyAdmin(setPolicy(A, B, SUSPEND, policy(2, NONE, ALL, HOUR)));
        assertAdminState(revoke, IGovernanceTypes.ProposalState.APPROVED);
        assertAdminState(ttl, IGovernanceTypes.ProposalState.APPROVED);

        executeAdmin(ttl, A);
        assertAdminState(revoke, IGovernanceTypes.ProposalState.APPROVED);
        executeAdmin(revoke, A);
        assertEq(RoleSet.unwrap(governance.getPolicy(TI_ID, REVOKE).requiredRoleMask), RoleSet.unwrap(only(ROLE_C)));
        assertEq(governance.getTi(TI_ID).proposalTtl, pilotTtl + DAY);
    }

    /// Each policy and the lifetime has its own time: a change, even one that
    /// sets the same value, overtakes the open changes of its rule alone.
    function test_EachRuleIsOvertakenByItsOwnChangesAlone() public {
        uint256[5] memory pending;
        for (uint8 kind = 0; kind < 4; kind++) {
            pending[kind] = setPolicy(A, B, IGovernanceTypes.PolicyKind(kind), pilot[kind]);
        }
        pending[4] = setTtl(A, B, pilotTtl);
        skip(HOUR);

        for (uint8 rule = 0; rule < 5; rule++) {
            if (rule < 4) applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind(rule), pilot[rule]));
            else applyAdmin(setTtl(A, B, pilotTtl));
            for (uint8 other = 0; other < 5; other++) {
                assertAdminState(
                    pending[other],
                    other <= rule ? IGovernanceTypes.ProposalState.EXPIRED : IGovernanceTypes.ProposalState.APPROVED
                );
            }
        }
    }

    /// A loosening overtakes too: a stricter change opened before it is decided again.
    function test_ALooseningOvertakesAStricterChange() public {
        uint256 stricter = setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        skip(HOUR);
        applyAdmin(setPolicy(A, B, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY)));
        assertAdminState(stricter, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// Only an executed change counts: a cancelled one overtakes nothing.
    function test_ACancelledChangeOvertakesNothing() public {
        uint256 waiting = setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        skip(HOUR);
        uint256 cancelled = setPolicy(A, B, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        cancelAdmin(cancelled, C);
        applyAdmin(waiting);
        assertEq(RoleSet.unwrap(governance.getPolicy(TI_ID, REVOKE).requiredRoleMask), RoleSet.unwrap(only(ROLE_C)));
    }

    /// Signer changes are never overtaken: keys rotated in parallel all apply.
    function test_ParallelSignerChangesAllApply() public {
        address other = makeAddr("other");
        uint256 first = addSigner(A, B, spare, ROLE_A);
        uint256 second = addSigner(A, B, other, ROLE_B);
        uint256 policyChange = setPolicy(A, B, SUSPEND, policy(2, NONE, ALL, HOUR));
        uint256 ttlChange = setTtl(A, B, pilotTtl + DAY);

        applyAdmin(first);
        applyAdmin(policyChange);
        applyAdmin(ttlChange);
        applyAdmin(second);
        assertTrue(governance.isSigner(TI_ID, spare));
        assertTrue(governance.isSigner(TI_ID, other));
    }

    /// Opened a second before the last change of its rule: overtaken. Opened
    /// in the same second, after it: not.
    function test_TheBoundaryIsTheSecondTheRuleWasSet() public {
        uint256 tightening = setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        uint64 setAt = governance.getAdminProposal(tightening).executableAt;
        vm.warp(setAt - 1);
        uint256 before = setPolicy(A, B, REVOKE, policy(3, only(ROLE_C), ALL, DAY));
        vm.warp(setAt);
        executeAdmin(tightening, A);
        uint256 same = setPolicy(A, B, REVOKE, policy(3, only(ROLE_C), ALL, DAY));

        assertAdminState(before, IGovernanceTypes.ProposalState.EXPIRED);
        assertAdminState(same, IGovernanceTypes.ProposalState.APPROVED);
        applyAdmin(same);
        assertEq(governance.getPolicy(TI_ID, REVOKE).threshold, 3);
    }

    /// An executed change stays EXECUTED when a later one sets its rule again.
    function test_AnExecutedChangeStaysExecuted() public {
        uint256 first = setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        applyAdmin(first);
        skip(HOUR);
        applyAdmin(setPolicy(A, B, REVOKE, policy(2, NONE, ALL, DAY)));
        assertAdminState(first, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// The times take the slots after the TI's last: one per policy, then the lifetime.
    function test_TheTimesAreStoredLast() public {
        uint256 ti = _tiSlot();
        assertEq(uint256(vm.load(address(governance), bytes32(ti + 11))), 0, "none at set-up");
        applyAdmin(setPolicy(A, B, REVOKE, policy(2, only(ROLE_C), ALL, DAY)));
        uint64 policyAt = uint64(vm.getBlockTimestamp());
        skip(HOUR);
        applyAdmin(setTtl(A, B, pilotTtl + DAY));

        uint256 policies = uint256(vm.load(address(governance), bytes32(ti + 11)));
        assertEq(uint64(policies >> 64), policyAt, "revoke's");
        assertEq(uint64(policies), 0, "suspend's");
        assertEq(policies >> 128, 0, "the others'");
        assertEq(uint64(uint256(vm.load(address(governance), bytes32(ti + 12)))), vm.getBlockTimestamp(), "ttl's");
        assertEq(uint32(uint256(vm.load(address(governance), bytes32(ti + 10)))), 0, "restorations stay");
    }

    function _tiSlot() private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.TiConfiguration")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(TI_ID, location)));
    }
}
