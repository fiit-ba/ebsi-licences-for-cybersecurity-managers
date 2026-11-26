pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IRuleChanges} from "../contracts/interfaces/IRuleChanges.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {PolicyRules} from "../contracts/libraries/PolicyRules.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// A quorum regained without a signature: a looser policy restarts the
/// timelock of the decisions of its kind approved before.
contract QuorumRegainedUnsignedTest is GovernanceTest {
    using PolicyRules for IGovernanceTypes.Policy;

    IGovernanceTypes.PolicyKind internal constant SUSPEND = IGovernanceTypes.PolicyKind.SUSPEND;
    IGovernanceTypes.PolicyKind internal constant REVOKE = IGovernanceTypes.PolicyKind.REVOKE;
    IGovernanceTypes.PolicyKind internal constant REINSTATE = IGovernanceTypes.PolicyKind.REINSTATE;
    IGovernanceTypes.PolicyKind internal constant ADMIN = IGovernanceTypes.PolicyKind.ADMIN;

    // -----------------------------------------------------------------------
    // What is looser: one test per dimension, and a mixed change
    // -----------------------------------------------------------------------

    function test_ALowerThresholdIsLooser() public pure {
        assertTrue(_with(3, only(ROLE_A), only(ROLE_C), DAY).asStrictAs(_base()), "higher");
        assertTrue(_base().asStrictAs(_base()), "the same");
        assertFalse(_with(1, only(ROLE_A), only(ROLE_C), DAY).asStrictAs(_base()), "lower");
    }

    function test_ADroppedRequiredRoleIsLooser() public pure {
        assertTrue(_with(2, both(ROLE_A, ROLE_B), only(ROLE_C), DAY).asStrictAs(_base()), "one added");
        assertFalse(_with(2, NONE, only(ROLE_C), DAY).asStrictAs(_base()), "dropped");
        assertFalse(_with(2, only(ROLE_B), only(ROLE_C), DAY).asStrictAs(_base()), "swapped");
    }

    function test_ADroppedVetoRoleIsLooser() public pure {
        assertTrue(_with(2, only(ROLE_A), ALL, DAY).asStrictAs(_base()), "one added");
        assertFalse(_with(2, only(ROLE_A), only(ROLE_B), DAY).asStrictAs(_base()), "swapped");
        assertFalse(
            _with(2, only(ROLE_A), both(ROLE_A, ROLE_C), DAY).asStrictAs(_with(2, only(ROLE_A), ALL, DAY)), "dropped"
        );
    }

    function test_AShorterTimelockIsLooser() public pure {
        assertTrue(_with(2, only(ROLE_A), only(ROLE_C), 2 * DAY).asStrictAs(_base()), "longer");
        assertFalse(_with(2, only(ROLE_A), only(ROLE_C), DAY - 1).asStrictAs(_base()), "shorter");
    }

    /// Stricter in one dimension does not make up for looser in another.
    function test_AMixedChangeIsLooser() public pure {
        assertFalse(_with(3, only(ROLE_A), only(ROLE_C), DAY - 1).asStrictAs(_base()), "threshold up, timelock down");
        assertFalse(_with(3, NONE, ALL, 2 * DAY).asStrictAs(_base()), "only the required role dropped");
    }

    // -----------------------------------------------------------------------
    // Behaviour
    // -----------------------------------------------------------------------

    /// Audit: a stricter policy took the quorum, a looser one gave it back,
    /// and the revocation executed at once on its old quorum.
    function test_AQuorumALooserPolicyRegainsWaitsAgain() public {
        uint256 id = _approveRevocation();
        uint64 quorumAt = uint64(vm.getBlockTimestamp());
        applyAdmin(setPolicy(A, C, REVOKE, policy(3, NONE, ALL, DAY)));
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        applyAdmin(setPolicy(A, C, REVOKE, pilot[uint8(REVOKE)]));
        assertGt(vm.getBlockTimestamp(), quorumAt + DAY, "the old delay is long over");
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// A loosening restarts a decision that never lost its quorum too.
    function test_ALooseningRestartsEveryApprovedDecisionOfItsKind() public {
        uint256 id = _approveRevocation();
        skip(HOUR);
        applyAdmin(setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY)));
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
    }

    /// A shorter timelock while the old one runs: the new length, from the change.
    function test_AShorterTimelockRunsFromTheChange() public {
        governance = deploy(_slow());
        uint256 shorter = setPolicy(A, B, REVOKE, policy(2, NONE, ALL, DAY));
        skip(DAY + DAY / 2);
        uint256 id = _approveRevocation();
        uint64 quorumAt = uint64(vm.getBlockTimestamp());
        applyAdmin(shorter);
        uint64 loosenedAt = uint64(vm.getBlockTimestamp());
        assertLt(loosenedAt, quorumAt + 2 * DAY, "the old delay still runs");
        assertEq(governance.getProposal(id).executableAt, loosenedAt + DAY);
        _executesExactlyAt(id);
    }

    /// A stricter policy the quorum still meets moves nothing.
    function test_AStricterPolicyKeepsTheDelay() public {
        governance = deploy(pilotWith(REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY)));
        uint256 tighter = setPolicy(A, C, REVOKE, policy(2, only(ROLE_A), ALL, DAY));
        skip(HOUR);
        uint256 id = _approveRevocation();
        uint64 executableAt = governance.getProposal(id).executableAt;
        applyAdmin(tighter);
        assertEq(governance.getProposal(id).executableAt, executableAt);
        assertEq(uint256(vm.load(address(governance), bytes32(_tiSlot() + 9))), 0, "no loosening recorded");
        _executesExactlyAt(id);
    }

    /// Each kind has its own: loosening reinstatement or suspension delays
    /// no revocation and no rule change.
    function test_LooseningAnotherKindDelaysNothing() public {
        uint256 reinstate = setPolicy(A, C, REINSTATE, policy(2, NONE, both(ROLE_A, ROLE_B), 0));
        uint256 suspend = setPolicy(A, C, SUSPEND, policy(2, NONE, both(ROLE_A, ROLE_B), 0));
        skip(HOUR);
        uint256 id = _approveRevocation();
        uint256 rule = setTtl(B, C, pilotTtl + DAY);
        uint64 executableAt = governance.getProposal(id).executableAt;
        uint64 ruleAt = governance.getAdminProposal(rule).executableAt;
        vm.warp(executableAt - 1);
        executeAdmin(reinstate, A);
        executeAdmin(suspend, A);
        assertEq(governance.getProposal(id).executableAt, executableAt);
        assertEq(governance.getAdminProposal(rule).executableAt, ruleAt);
        _executesExactlyAt(id);
        executeAdmin(rule, A);
    }

    /// Adding, replacing and removing a key, or a new lifetime, after the
    /// quorum delay nothing: none of them can give a quorum back.
    function test_OtherRuleChangesDelayNothing() public {
        address extra = makeAddr("extra");
        address next = makeAddr("next");
        address[] memory signers = new address[](4);
        (signers[0], signers[1], signers[2], signers[3]) = (A, B, C, extra);
        Role[] memory signerRoles = new Role[](4);
        (signerRoles[0], signerRoles[1], signerRoles[2], signerRoles[3]) = (ROLE_A, ROLE_B, ROLE_C, ROLE_C);
        governance = deploy(signers, signerRoles, pilotPolicies(), pilotTtl);

        uint256[4] memory changes = [
            addSigner(A, B, spare, ROLE_A),
            replaceSigner(A, B, C, next),
            removeSigner(A, B, extra),
            setTtl(A, B, pilotTtl + DAY)
        ];
        skip(HOUR);
        uint256 id = _approveRevocation();
        uint64 executableAt = governance.getProposal(id).executableAt;
        vm.warp(executableAt - 1);
        for (uint256 i = 0; i < changes.length; i++) {
            executeAdmin(changes[i], A);
            assertEq(governance.getProposal(id).executableAt, executableAt);
        }
        _executesExactlyAt(id);
    }

    /// A loosening before the quorum delays nothing, and the event carries
    /// the same time as the view.
    function test_ALooseningBeforeTheQuorumDelaysNothing() public {
        governance = deploy(pilotWith(REVOKE, policy(3, NONE, ALL, DAY)));
        applyAdmin(setPolicy(A, B, REVOKE, pilot[uint8(REVOKE)]));
        skip(HOUR);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        vm.expectEmit(address(governance));
        emit IStatusProposals.QuorumReached(id, uint64(vm.getBlockTimestamp()) + DAY);
        sign(id, B);
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
    }

    /// A rule change's own ballot restarts after a looser rule-change policy.
    function test_ARuleChangeWaitsAgainAfterALooserAdminPolicy() public {
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        policies[uint8(ADMIN)].timelock = 2 * DAY;
        governance = deploy(policies);
        uint256 faster = setPolicy(A, B, ADMIN, policy(2, NONE, ALL, DAY));
        skip(DAY + DAY / 2);
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminQuorumReached(rule, uint64(vm.getBlockTimestamp()) + 2 * DAY);
        signAdmin(rule, C);
        applyAdmin(faster);
        uint64 restarted = uint64(vm.getBlockTimestamp()) + DAY;
        assertEq(governance.getAdminProposal(rule).executableAt, restarted);
        vm.warp(restarted - 1);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, restarted));
        governance.executeAdminProposal(rule);
        vm.warp(restarted);
        executeAdmin(rule, A);
    }

    /// A decision without a delay is not held back.
    function test_ADecisionWithoutADelayIsNotHeldBack() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, B);
        applyAdmin(setPolicy(A, C, SUSPEND, policy(3, NONE, ALL, 0)));
        applyAdmin(setPolicy(A, C, SUSPEND, pilot[uint8(SUSPEND)]));
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp());
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// A loosening just before the end restarts the delay past it: the
    /// lifetime follows, to a day after the new `executableAt`.
    function test_ALateLooseningExtendsTheLifetime() public {
        uint256 id = _approveRevocation();
        uint64 expiresAt = uint64(vm.getBlockTimestamp()) + pilotTtl;
        uint256 loosening = setPolicy(A, B, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(expiresAt - HOUR);
        executeAdmin(loosening, A);
        uint64 executableAt = expiresAt - HOUR + DAY;
        assertEq(governance.getProposal(id).executableAt, executableAt);
        assertEq(governance.getProposal(id).expiresAt, executableAt + DAY);

        vm.warp(expiresAt);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        _executesExactlyAt(id);
    }

    /// A looser threshold the signatures already meet does not approve a
    /// proposal: only a signature does, and its delay starts then.
    function test_ALooserThresholdApprovesNothingWithoutASignature() public {
        governance = deploy(pilotWith(REVOKE, policy(3, NONE, ALL, DAY)));
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        applyAdmin(setPolicy(A, C, REVOKE, pilot[uint8(REVOKE)]));
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        assertEq(governance.getProposal(id).executableAt, 0);
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        skip(HOUR);
        sign(id, C);
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
    }

    /// A quorum a signature regains after the loosening runs from that signature.
    function test_ASignatureAfterTheLooseningStartsItsOwnDelay() public {
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_C), DAY));
        uint256 removal = removeSigner(A, C, B);
        uint256 id = _approveRevocation();
        skip(DAY);
        executeAdmin(looser, A);
        executeAdmin(removal, A);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        skip(HOUR);
        vm.expectEmit(address(governance));
        emit IStatusProposals.QuorumReached(id, uint64(vm.getBlockTimestamp()) + DAY);
        sign(id, C);
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
    }

    /// A later loosening moves it again; a tightening after it gives nothing back.
    function test_TheLatestLooseningCountsAndATighteningKeepsIt() public {
        uint256 id = _approveRevocation();
        applyAdmin(setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_C), DAY)));
        uint64 first = uint64(vm.getBlockTimestamp());
        applyAdmin(setPolicy(A, C, REVOKE, policy(2, NONE, only(ROLE_C), DAY)));
        uint64 second = uint64(vm.getBlockTimestamp());
        assertGt(second, first);
        assertEq(governance.getProposal(id).executableAt, second + DAY);
        uint256 tighter = setPolicy(B, C, REVOKE, policy(2, NONE, ALL, DAY));

        vm.warp(second + DAY - 1);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, second + DAY));
        governance.execute(id);
        vm.warp(second + DAY);
        executeAdmin(tighter, A);
        assertEq(governance.getProposal(id).executableAt, second + DAY);
        execute(id, A);
    }

    /// The same policy set again moves nothing.
    function test_TheSamePolicyAgainMovesNothing() public {
        uint256 same = setPolicy(A, C, REVOKE, pilot[uint8(REVOKE)]);
        skip(HOUR);
        uint256 id = _approveRevocation();
        uint64 executableAt = governance.getProposal(id).executableAt;
        vm.warp(executableAt - 1);
        executeAdmin(same, A);
        assertEq(governance.getProposal(id).executableAt, executableAt);
        _executesExactlyAt(id);
    }

    /// Each TI has its own times.
    function test_AnotherTisLooseningDelaysNothing() public {
        string memory other = "did:ebsi:zOtherTi";
        accreditTi(other);
        vm.prank(tao);
        bytes32 otherId = governance.addTi(setup(other, keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilot, pilotTtl));
        vm.prank(A);
        uint256 looser = governance.proposePolicy(otherId, REVOKE, 2, NONE, only(ROLE_C), DAY);
        signAdmin(looser, B);
        skip(HOUR);
        uint256 id = _approveRevocation();
        uint64 executableAt = governance.getProposal(id).executableAt;
        vm.warp(executableAt - 1);
        executeAdmin(looser, A);
        assertEq(governance.getProposal(id).executableAt, executableAt);
        _executesExactlyAt(id);
    }

    /// A loosening in the block that reaches the quorum: one delay from then.
    function test_ALooseningInTheQuorumsBlock() public {
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        skip(DAY);
        executeAdmin(looser, A);
        sign(id, B);
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
        _executesExactlyAt(id);
    }

    /// The boundary: a delay that ends exactly at the old end still runs.
    function test_ALooseningThatEndsTheDelayAtTheOldEndStillRuns() public {
        uint256 id = _approveRevocation();
        uint64 expiresAt = uint64(vm.getBlockTimestamp()) + pilotTtl;
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(expiresAt - DAY);
        executeAdmin(looser, A);
        assertEq(governance.getProposal(id).executableAt, expiresAt);
        assertEq(governance.getProposal(id).expiresAt, expiresAt + DAY);
        _executesExactlyAt(id);
    }

    /// A second earlier, the same: a full day is always left to execute.
    function test_ALooseningThatEndsTheDelayJustBeforeTheOldEndLeavesADay() public {
        uint256 id = _approveRevocation();
        uint64 expiresAt = uint64(vm.getBlockTimestamp()) + pilotTtl;
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(expiresAt - DAY - 1);
        executeAdmin(looser, A);
        assertEq(governance.getProposal(id).executableAt, expiresAt - 1);
        assertEq(governance.getProposal(id).expiresAt, expiresAt - 1 + DAY);
        _executesExactlyAt(id);
    }

    /// Documented: a key the DID Registry drops and lists again brings its
    /// signature back on the old delay. A veto still stops the decision.
    function test_AKeyListedAgainKeepsTheOldDelayButAVetoStopsIt() public {
        uint256 id = _approveRevocation();
        uint64 quorumAt = uint64(vm.getBlockTimestamp());
        _listForTheTi(B, false);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);
        _listForTheTi(B, true);
        assertEq(governance.getProposal(id).executableAt, quorumAt + DAY);

        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The times take a slot after the TI's last; nothing moves.
    function test_TheTimesAreStoredLast() public {
        uint256 ti = _tiSlot();
        bytes32 before = vm.load(address(governance), bytes32(ti + 8));
        assertEq(uint256(vm.load(address(governance), bytes32(ti + 9))), 0, "none at set-up");

        applyAdmin(setPolicy(A, B, REVOKE, policy(2, NONE, ALL, DAY - 1)));
        uint256 slot = uint256(vm.load(address(governance), bytes32(ti + 9)));
        assertEq(uint64(slot >> (64 * uint8(REVOKE))), vm.getBlockTimestamp(), "revoke's");
        assertEq(slot >> 128, 0, "the others'");
        assertEq(uint64(slot), 0, "suspend's");
        uint256 after_ = uint256(vm.load(address(governance), bytes32(ti + 8)));
        assertEq(uint64(after_ >> 64), uint64(uint256(before) >> 64) + 1, "version");
        assertEq(after_ >> 192, ACCREDITED_UNTIL, "accreditedUntil stays");
        assertEq(uint256(vm.load(address(governance), bytes32(ti + 10))), 0, "nothing after");
    }

    // -----------------------------------------------------------------------

    /// The view's `executableAt` is exactly what `execute` enforces.
    function _executesExactlyAt(uint256 id) private {
        uint64 at = governance.getProposal(id).executableAt;
        assertGt(at, vm.getBlockTimestamp(), "still ahead");
        vm.warp(at - 1);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, at));
        governance.execute(id);
        vm.warp(at);
        execute(id, A);
    }

    function _base() private pure returns (IGovernanceTypes.Policy memory) {
        return _with(2, only(ROLE_A), only(ROLE_C), DAY);
    }

    function _with(uint8 threshold, RoleSet required, RoleSet veto, uint64 timelock)
        private
        pure
        returns (IGovernanceTypes.Policy memory)
    {
        return policy(threshold, required, veto, timelock);
    }

    function _slow() private view returns (IGovernanceTypes.Policy[4] memory policies) {
        policies = pilotWith(REVOKE, policy(2, NONE, ALL, 2 * DAY));
        policies[uint8(ADMIN)].timelock = 2 * DAY;
    }

    function _tiSlot() private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.TiConfiguration")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(TI_ID, location)));
    }

    function _listForTheTi(address key, bool listed) private {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, key, listed);
    }

    function _approveRevocation() private returns (uint256 id) {
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }
}
