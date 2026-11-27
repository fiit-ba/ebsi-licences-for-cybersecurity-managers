pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// An approval can always be carried out: once approved, a proposal stays open
/// at least a day past its `executableAt`, up to MAX_PROPOSAL_TTL from opening.
contract LateQuorumTest is GovernanceTest {
    IGovernanceTypes.PolicyKind internal constant REVOKE = IGovernanceTypes.PolicyKind.REVOKE;

    /// Audit: the second signature on day 29.5 of 30 approved a revocation
    /// executable on day 30.5, after it expired.
    function test_ALateQuorumExtendsTheLifetime() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - DAY / 2);
        sign(id, B);
        uint64 executableAt = end + DAY / 2;
        assertEq(governance.getProposal(id).executableAt, executableAt);
        assertEq(governance.getProposal(id).expiresAt, executableAt + DAY);

        vm.warp(end);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        _executesAt(id, executableAt);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// The new end is exact: open a second before it, expired at it.
    function test_TheExtendedEndIsExact() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        uint64 extended = governance.getProposal(id).expiresAt;
        assertEq(extended, end - HOUR + 2 * DAY);

        vm.warp(extended - 1);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);
        vm.warp(extended);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        vm.prank(outsider);
        governance.expireProposal(id);
    }

    /// The boundary: a quorum that leaves exactly a day after `executableAt`
    /// moves nothing; a second later moves the end by a second.
    function test_TheEndMovesOnlyWhenLessThanADayWouldBeLeft() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint256 other = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - 2 * DAY);
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, end, "a day is left");
        skip(1);
        sign(other, B);
        assertEq(governance.getProposal(other).expiresAt, end + 1, "a second short");
    }

    /// An early quorum keeps the lifetime it opened with.
    function test_AnEarlyQuorumKeepsTheLifetime() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, end);
    }

    /// A quorum a signature regains late extends it from that signature.
    function test_AQuorumRegainedLateExtendsIt() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        uint64 end = governance.getProposal(id).expiresAt;
        applyAdmin(removeSigner(A, C, B));
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        vm.warp(end - HOUR);
        sign(id, C);
        uint64 executableAt = end - HOUR + DAY;
        assertEq(governance.getProposal(id).expiresAt, executableAt + DAY);
        _executesAt(id, executableAt);
    }

    /// A timelock raised after the quorum moves `executableAt`, and the end
    /// follows.
    function test_ARaisedTimelockExtendsIt() public {
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].timelock = 2 * DAY;
        governance = deploy(policies);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;

        vm.warp(end - 4 * DAY);
        uint256 raise = setPolicy(A, B, REVOKE, policy(2, NONE, ALL, 2 * DAY));
        vm.warp(end - 2 * DAY);
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, end, "a day was left");
        executeAdmin(raise, A);
        assertEq(governance.getProposal(id).executableAt, end);
        assertEq(governance.getProposal(id).expiresAt, end + DAY);
        _executesAt(id, end);
    }

    /// A rule change approved late is extended too.
    function test_ALateRuleChangeIsExtended() public {
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        uint64 end = governance.getAdminProposal(rule).expiresAt;
        vm.warp(end - HOUR);
        signAdmin(rule, B);
        uint64 executableAt = end - HOUR + DAY;
        assertEq(governance.getAdminProposal(rule).expiresAt, executableAt + DAY);

        vm.warp(end);
        assertAdminState(rule, IGovernanceTypes.ProposalState.APPROVED);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireAdminProposal(rule);
        vm.warp(executableAt);
        executeAdmin(rule, A);
        assertEq(governance.getTi(TI_ID).proposalTtl, pilotTtl + DAY);
    }

    /// The veto holds while the extension runs.
    function test_TheVetoHoldsInTheExtension() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        vm.warp(end + HOUR);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// Capped at MAX_PROPOSAL_TTL from opening: past it, the approval lapses.
    function test_TheExtensionIsCapped() public {
        uint64 max = governance.MAX_PROPOSAL_TTL();
        governance = deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), max);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 cap = governance.getProposal(id).proposedAt + max;
        vm.warp(cap - HOUR);
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, cap);

        vm.warp(cap);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.warp(governance.getProposal(id).executableAt);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
    }

    /// A later restart near the cap does not push past it either.
    function test_ALaterRestartStopsAtTheCap() public {
        uint64 max = governance.MAX_PROPOSAL_TTL();
        governance = deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), max - DAY);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 cap = governance.getProposal(id).proposedAt + max;
        uint64 end = cap - DAY;
        vm.warp(end - HOUR);
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, cap, "extended to the cap");

        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(cap - HOUR);
        executeAdmin(looser, A);
        assertGt(governance.getProposal(id).executableAt, cap);
        assertEq(governance.getProposal(id).expiresAt, cap, "no further");
        vm.warp(cap);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// A ballot opened before `expiresAt` was stored still has no end.
    function test_ABallotFromBeforeStaysWithoutAnEnd() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        bytes32 slot = bytes32(_proposalSlot(id) + 5);
        uint256 packed = uint256(vm.load(address(governance), slot));
        vm.store(address(governance), slot, bytes32(packed & ~(uint256(type(uint64).max) << 72)));
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, 0);
        skip(2 * pilotTtl);
        execute(id, A);
    }

    /// A decision without a timelock approved a second before the end still
    /// gets a day.
    function test_ADecisionWithoutATimelockApprovedAtTheEndGetsADay() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - 1);
        sign(id, B);
        assertEq(governance.getProposal(id).expiresAt, end - 1 + DAY);
        vm.warp(end + HOUR);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// While extended, the proposal still holds its certificate; after, the
    /// next proposal replaces it.
    function test_AnExtendedProposalStillHoldsItsCertificate() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        // Past where a decision without a timelock would have lapsed.
        vm.warp(end + DAY);
        vm.prank(B);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.ProposalAlreadyOpen.selector, id));
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);

        vm.warp(governance.getProposal(id).expiresAt);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(id, CERTIFICATE);
        propose(B, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
    }

    /// A cosigner change ends an extended proposal too.
    function test_ACosignerChangeEndsAnExtendedProposal() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        vm.warp(end + HOUR);
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerD", Role.wrap(4));
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// A signature in the extension that changes nothing about the quorum
    /// moves nothing.
    function test_ASignatureInTheExtensionMovesNothing() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        IGovernanceTypes.ProposalView memory before = governance.getProposal(id);
        vm.warp(end + HOUR);
        sign(id, C);
        assertEq(governance.getProposal(id).executableAt, before.executableAt);
        assertEq(governance.getProposal(id).expiresAt, before.expiresAt);
    }

    /// A restart inside the extension extends it again.
    function test_ARestartInTheExtensionExtendsItAgain() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 end = governance.getProposal(id).expiresAt;
        vm.warp(end - HOUR);
        sign(id, B);
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(end + DAY - HOUR);
        executeAdmin(looser, A);
        uint64 executableAt = end + 2 * DAY - HOUR;
        assertEq(governance.getProposal(id).executableAt, executableAt);
        assertEq(governance.getProposal(id).expiresAt, executableAt + DAY);
        _executesAt(id, executableAt);
    }

    /// A rule change opened before `expiresAt` was stored has no end either.
    function test_ARuleChangeFromBeforeStaysWithoutAnEnd() public {
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        uint64 end = governance.getAdminProposal(rule).expiresAt;
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.RuleChanges")) - 1)) & ~bytes32(uint256(0xff));
        // AdminChange takes four slots, the ballot's third holds expiresAt.
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(rule, uint256(location) + 1))) + 6);
        uint256 packed = uint256(vm.load(address(governance), slot));
        assertEq(uint64(packed >> 72), end, "the slot holds expiresAt");
        vm.store(address(governance), slot, bytes32(packed & ~(uint256(type(uint64).max) << 72)));
        assertEq(governance.getAdminProposal(rule).expiresAt, 0);
        skip(2 * pilotTtl);
        signAdmin(rule, B);
        assertEq(governance.getAdminProposal(rule).expiresAt, 0);
        skip(DAY);
        executeAdmin(rule, A);
    }

    // -----------------------------------------------------------------------
    // An end once reached stays reached
    // -----------------------------------------------------------------------

    /// Audit: an approved revocation past its end came back after a loosening
    /// of its policy, and executed on its old signatures.
    function test_ALaterLooseningRevivesNoExpiredDecision() public {
        uint256 id = _approvedRevocation();
        uint64 end = governance.getProposal(id).expiresAt;
        skip(10 * DAY);
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        vm.warp(end);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);

        executeAdmin(looser, A);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.getProposal(id).expiresAt, end);
        skip(DAY);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Nor does a raised timelock.
    function test_ALaterRaisedTimelockRevivesNoExpiredDecision() public {
        uint256 id = _approvedRevocation();
        uint64 end = governance.getProposal(id).expiresAt;
        skip(10 * DAY);
        applyAdmin(setPolicy(A, C, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY)));
        uint256 slower = setPolicy(A, C, REVOKE, policy(2, NONE, ALL, 2 * DAY));
        vm.warp(end);
        executeAdmin(slower, A);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.getProposal(id).expiresAt, end);
    }

    /// The same for a rule change: an expired one stays expired when ADMIN's
    /// timelock is raised.
    function test_ALaterRaisedTimelockRevivesNoExpiredRuleChange() public {
        uint256 ttl = setTtl(A, B, pilotTtl + DAY);
        uint64 end = governance.getAdminProposal(ttl).expiresAt;
        skip(10 * DAY);
        uint256 slower = setPolicy(A, C, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY));
        vm.warp(end);
        assertAdminState(ttl, IGovernanceTypes.ProposalState.EXPIRED);
        executeAdmin(slower, A);
        assertAdminState(ttl, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.getAdminProposal(ttl).expiresAt, end);
    }

    /// A change made a second before a ballot's end moves it; one made at its
    /// end does not.
    function test_TheEndIsTheLastSecondAChangeMovesIt() public {
        uint256 atEnd = _approvedRevocation();
        uint64 end = governance.getProposal(atEnd).expiresAt;
        skip(1);
        uint256 before = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(before, B);
        assertEq(governance.getProposal(before).expiresAt, end + 1);
        skip(10 * DAY);
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));

        vm.warp(end);
        executeAdmin(looser, A);
        assertState(atEnd, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.getProposal(before).expiresAt, end + 2 * DAY, "moved");
        _executesAt(before, end + DAY);
    }

    /// Limit, on the safe side: the stored end is the one from the quorum, so a
    /// second change of the policy after it, inside an extension an earlier
    /// change gave, ends the decision; it never executes late.
    function test_ASecondChangeAfterTheStoredEndEndsAnExtension() public {
        uint256 id = _approvedRevocation();
        uint64 end = governance.getProposal(id).expiresAt;
        skip(10 * DAY);
        uint256 first = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_C), DAY));
        vm.warp(end - HOUR);
        executeAdmin(first, A);
        assertEq(governance.getProposal(id).expiresAt, end - HOUR + 2 * DAY, "extended");
        uint256 second = setPolicy(B, C, REVOKE, policy(2, NONE, only(ROLE_C), DAY));

        vm.warp(end - HOUR + DAY);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        executeAdmin(second, A);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.getProposal(id).expiresAt, end);
    }

    /// A quorum lost to a stricter policy and met again by a loosening made
    /// after the end stays expired: no signature, no revival.
    function test_AQuorumMetAgainByALateLooseningStaysExpired() public {
        uint256 id = _approvedRevocation();
        uint64 end = governance.getProposal(id).expiresAt;
        skip(DAY);
        applyAdmin(setPolicy(A, C, REVOKE, policy(2, only(ROLE_C), ALL, DAY)));
        assertEq(governance.getProposal(id).expiresAt, end, "a tightening moves nothing");
        uint256 looser = setPolicy(A, C, REVOKE, policy(2, NONE, ALL, DAY));

        vm.warp(end);
        executeAdmin(looser, A);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
    }

    /// A quorum regained by a signature inside an extension stores a new end,
    /// so a later change before it still moves it.
    function test_AQuorumRegainedInAnExtensionStoresANewEnd() public {
        uint256 id = _approvedRevocation();
        uint64 end = governance.getProposal(id).expiresAt;
        skip(10 * DAY);
        uint256 first = setPolicy(A, C, REVOKE, policy(2, NONE, both(ROLE_A, ROLE_C), DAY));
        vm.warp(end - HOUR);
        executeAdmin(first, A);

        vm.warp(end + HOUR);
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, B, false);
        sign(id, C);
        uint64 stored = end + HOUR + 2 * DAY;
        assertEq(governance.getProposal(id).expiresAt, stored, "stored again");
        uint256 second = setPolicy(A, C, REVOKE, policy(2, NONE, only(ROLE_C), DAY));

        vm.warp(stored - DAY);
        executeAdmin(second, A);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        assertEq(governance.getProposal(id).expiresAt, stored + DAY, "moved");
        _executesAt(id, stored);
    }

    /// The end is stored at the quorum: a day past `executableAt`, never before
    /// the lifetime's end.
    function test_TheEndIsStoredAtTheQuorum() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 lifetimeEnd = governance.getProposal(id).expiresAt;
        vm.warp(lifetimeEnd - HOUR);
        sign(id, B);
        uint256 packed = uint256(vm.load(address(governance), bytes32(_proposalSlot(id) + 5)));
        assertEq(uint64(packed >> 72), lifetimeEnd - HOUR + 2 * DAY, "raised in storage");

        uint256 early = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        uint64 earlyEnd = governance.getProposal(early).expiresAt;
        sign(early, B);
        packed = uint256(vm.load(address(governance), bytes32(_proposalSlot(early) + 5)));
        assertEq(uint64(packed >> 72), earlyEnd, "an early quorum keeps it");
    }

    function _approvedRevocation() private returns (uint256 id) {
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
    }

    function _executesAt(uint256 id, uint64 executableAt) private {
        vm.warp(executableAt - 1);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        governance.execute(id);
        vm.warp(executableAt);
        execute(id, A);
    }

    function _proposalSlot(uint256 id) private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(id, uint256(location) + 2)));
    }
}
