pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {RoleSet} from "../contracts/libraries/Roles.sol";

/**
 * Rule changes are at least as strict as the decisions they govern: ADMIN
 * waits at least as long as every status policy, and every role that may veto
 * a decision may veto a rule change. A rule change can then never apply
 * before the decision it would weaken, and the role a delay is for can always
 * stop either.
 */
contract AdminPolicyCoversTest is GovernanceTest {
    /// Audit: A and B, compromised, approved a revocation, then stripped C's
    /// veto and the timelock from the revocation policy in the same block, and
    /// executed it. The rule change now waits as long as the revocation, so C
    /// vetoes in time.
    function test_AVetoStripWaitsForTheDecisionItWouldWeaken() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        uint256 strip = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, only(ROLE_A), 0));

        assertAdminState(strip, IGovernanceTypes.ProposalState.APPROVED);
        assertGe(governance.getAdminProposal(strip).executableAt, governance.getProposal(id).executableAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                IGovernanceTypes.TimelockNotElapsed.selector, governance.getAdminProposal(strip).executableAt
            )
        );
        executeAdmin(strip, A);

        cancel(id, C, REASON);
        cancelAdmin(strip, C);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
        assertAdminState(strip, IGovernanceTypes.ProposalState.CANCELLED);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Audit: removing the honest role's only key during a timelock. It waits
    /// as long, so the honest role vetoes the decision before it loses its key.
    function test_RemovingAKeyWaitsAsLongAsTheDecisionItCouldUnblock() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        uint256 removal = removeSigner(A, B, C);
        assertGe(governance.getAdminProposal(removal).executableAt, governance.getProposal(id).executableAt);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    // -----------------------------------------------------------------------
    // Setting a TI up
    // -----------------------------------------------------------------------

    function test_RevertWhen_ATisRuleChangesWouldBeFasterThanARevocation() public {
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY - 1)));
    }

    function test_RevertWhen_ATiGivesAVetoOnADecisionButNotOnRuleChanges() public {
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY)));
    }

    function test_RevertWhen_ATisSuspensionWaitsLongerThanItsRuleChanges() public {
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(pilotWith(IGovernanceTypes.PolicyKind.SUSPEND, policy(2, NONE, ALL, DAY + 1)));
    }

    /// With no decision waiting out a timelock, rule changes need none either,
    /// and apply with the signature that completes their quorum.
    function test_ARuleChangeAppliesAtOnceWhenNoDecisionWaits() public {
        governance = deploy(_allPolicies(ALL, 0));
        uint256 id = addSigner(A, B, spare, ROLE_A);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
        assertTrue(governance.isSigner(TI_ID, spare));
    }

    // -----------------------------------------------------------------------
    // Changing a policy: either side, at proposal and again at execution
    // -----------------------------------------------------------------------

    function test_RevertWhen_AChangeWouldShortenRuleChangesBelowARevocation() public {
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY - 1));
    }

    function test_RevertWhen_AChangeWouldTakeAVetoFromRuleChanges() public {
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
    }

    function test_RevertWhen_AChangeWouldMakeARevocationWaitLongerThanRuleChanges() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, DAY + 1));
    }

    function test_RevertWhen_AChangeWouldGiveADecisionAVetoRuleChangesLack() public {
        governance = deploy(_allPolicies(both(ROLE_A, ROLE_B), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.SUSPEND, policy(2, NONE, ALL, 0));
    }

    /// Tightening rule changes, or narrowing a decision's veto, keeps ADMIN
    /// covering every decision.
    function test_AcceptsChangesThatKeepRuleChangesTheStrictest() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY)));
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, only(ROLE_C), 2 * DAY)));
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE).timelock, 2 * DAY);
    }

    /// Each change keeps ADMIN covering the decisions as they stood when it
    /// was proposed, but not the two together: the second is refused when it
    /// would apply.
    function test_RevertWhen_TwoApprovedChangesTogetherLeaveRuleChangesFaster() public {
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY)));
        uint256 faster = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY));
        uint256 slower = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, 2 * DAY));
        applyAdmin(faster);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        executeAdmin(slower, A);
    }

    // -----------------------------------------------------------------------
    // Every status policy alike, and the boundary
    // -----------------------------------------------------------------------

    /// For SUSPEND, REVOKE and REINSTATE each: a TI whose rule changes wait a
    /// second less, or lack one of its veto roles, is refused; one whose rule
    /// changes wait exactly as long, with exactly its veto roles, is set up.
    function test_EveryStatusPolicyIsCoveredAtSetUpAndTheBoundaryHolds() public {
        for (uint8 kind = 0; kind < uint8(IGovernanceTypes.PolicyKind.ADMIN); kind++) {
            IGovernanceTypes.Policy[4] memory policies = _allPolicies(ALL, 0);
            policies[kind].timelock = DAY;
            policies[3].timelock = DAY - 1;
            vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
            deploy(policies);

            policies = _allPolicies(both(ROLE_A, ROLE_B), DAY);
            policies[kind].vetoRoleMask = ALL;
            vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
            deploy(policies);

            policies = _allPolicies(both(ROLE_B, ROLE_C), 0);
            policies[kind].timelock = DAY;
            policies[3].timelock = DAY;
            governance = deploy(policies);
            assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN).timelock, DAY);
        }
    }

    /// For each status policy, a change that would make it wait longer than
    /// rule changes, or give it a veto role they lack, is refused; one that
    /// matches ADMIN exactly is accepted.
    function test_EveryStatusPolicyIsCoveredOnChangeAndTheBoundaryHolds() public {
        governance = deploy(_allPolicies(both(ROLE_B, ROLE_C), DAY));
        for (uint8 kind = 0; kind < uint8(IGovernanceTypes.PolicyKind.ADMIN); kind++) {
            IGovernanceTypes.PolicyKind k = IGovernanceTypes.PolicyKind(kind);
            _expectRefused(k, policy(2, NONE, both(ROLE_B, ROLE_C), DAY + 1));
            _expectRefused(k, policy(2, NONE, ALL, DAY));
            vm.prank(A);
            governance.proposePolicy(TI_ID, k, 2, NONE, both(ROLE_B, ROLE_C), DAY);
        }
    }

    /// ADMIN may not drop any one veto role a status policy holds, nor wait a
    /// second less than the longest status timelock.
    function test_RuleChangesKeepEveryVetoRoleAndTheLongestDelay() public {
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_B, ROLE_C), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_C), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY - 1));
        vm.prank(A);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN, 2, NONE, ALL, DAY);
    }

    /// Only policy changes are held to the rule: a rule change that moves no
    /// policy is not refused for it, so rotating a key and changing the
    /// lifetime still work.
    function test_OtherRuleChangesAreNotHeldToIt() public {
        applyAdmin(addSigner(A, B, spare, ROLE_A));
        applyAdmin(setTtl(A, B, 7 * DAY));
        assertTrue(governance.isSigner(TI_ID, spare));
        assertEq(governance.getTi(TI_ID).proposalTtl, 7 * DAY);
    }

    // -----------------------------------------------------------------------
    // A TI set up before the rule, under the old pilot (ADMIN without delay)
    // -----------------------------------------------------------------------

    /// What a beacon upgrade finds on a TI set up with the old pilot rules:
    /// its status policies are not changed until ADMIN covers them again, and
    /// raising ADMIN, under its old zero delay, applies at once.
    function test_ATiSetUpBeforeTheRuleRaisesItsRuleChangesFirst() public {
        _forgeLegacyAdminWithoutDelay();
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN).timelock, 0);

        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, DAY));
        // A key rotation is no policy change and still applies, at once.
        uint256 rotation = addSigner(A, B, spare, ROLE_A);
        assertAdminState(rotation, IGovernanceTypes.ProposalState.EXECUTED);

        uint256 raise = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY));
        assertAdminState(raise, IGovernanceTypes.ProposalState.EXECUTED);
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY)));
        assertEq(
            RoleSet.unwrap(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE).requiredRoleMask),
            RoleSet.unwrap(only(ROLE_C))
        );
    }

    /// Sets the pilot TI's ADMIN timelock to 0 in storage, as the old pilot
    /// rules left it: no transaction can now.
    function _forgeLegacyAdminWithoutDelay() private {
        bytes32 location = keccak256(abi.encode(uint256(keccak256("plr.storage.TiConfiguration")) - 1))
            & ~bytes32(uint256(0xff));
        // TiConfig: did, attributeId, signers, cosigners, then the four
        // policies, one slot each; ADMIN is the fourth. A policy packs
        // threshold, required roles, veto roles (a byte each), then timelock.
        bytes32 admin = bytes32(uint256(keccak256(abi.encode(TI_ID, location))) + 4 + 3);
        uint256 packed = uint256(vm.load(address(governance), admin));
        assertEq((packed >> 24) & type(uint64).max, DAY, "the slot is ADMIN's");
        vm.store(address(governance), admin, bytes32(packed & ~(uint256(type(uint64).max) << 24)));
    }

    function _expectRefused(IGovernanceTypes.PolicyKind kind, IGovernanceTypes.Policy memory refused) private {
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        vm.prank(A);
        governance.proposePolicy(
            TI_ID, kind, refused.threshold, refused.requiredRoleMask, refused.vetoRoleMask, refused.timelock
        );
    }

    /// The pilot's thresholds, with every policy given `veto` and `timelock`.
    function _allPolicies(RoleSet veto, uint64 timelock)
        private
        view
        returns (IGovernanceTypes.Policy[4] memory policies)
    {
        policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].vetoRoleMask = veto;
            policies[i].timelock = timelock;
        }
    }
}
