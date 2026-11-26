pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {RoleSet} from "../contracts/libraries/Roles.sol";

/// ADMIN waits as long as every status policy and holds all their veto roles.
contract AdminPolicyCoversTest is GovernanceTest {
    /// Audit: two roles stripped C's veto and the timelock in one block.
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

    /// Audit: removing the honest role's only key during a timelock.
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

    function test_AcceptsChangesThatKeepRuleChangesTheStrictest() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY)));
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, only(ROLE_C), 2 * DAY)));
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE).timelock, 2 * DAY);
    }

    /// Each passes alone; the second is refused at execution.
    function test_RevertWhen_TwoApprovedChangesTogetherLeaveRuleChangesFaster() public {
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 2 * DAY)));
        uint256 faster = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY));
        uint256 slower = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, 2 * DAY));
        applyAdmin(faster);
        // The faster policy is looser: the other change waits again.
        uint64 restarted = uint64(vm.getBlockTimestamp()) + DAY;
        assertEq(governance.getAdminProposal(slower).executableAt, restarted);
        vm.warp(restarted);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        executeAdmin(slower, A);
    }

    // -----------------------------------------------------------------------
    // Every status policy alike, and the boundary
    // -----------------------------------------------------------------------

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

    function test_RuleChangesKeepEveryVetoRoleAndTheLongestDelay() public {
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_B, ROLE_C), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_C), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY - 1));
        vm.prank(A);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN, 2, NONE, ALL, DAY);
    }

    function test_OtherRuleChangesAreNotHeldToIt() public {
        applyAdmin(addSigner(A, B, spare, ROLE_A));
        applyAdmin(setTtl(A, B, 7 * DAY));
        assertTrue(governance.isSigner(TI_ID, spare));
        assertEq(governance.getTi(TI_ID).proposalTtl, 7 * DAY);
    }

    // -----------------------------------------------------------------------
    // A required role vetoes rule changes too
    // -----------------------------------------------------------------------

    /// Audit: C required on revocations, only A and B veto. A and B would
    /// drop the requirement with no say from C.
    function test_RevertWhen_ATiRequiresARoleItsRuleChangesCannotHear() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(both(ROLE_A, ROLE_B), DAY);
        policies[uint8(IGovernanceTypes.PolicyKind.REVOKE)].requiredRoleMask = only(ROLE_C);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(policies);
    }

    /// With C's veto on rule changes, C stops the change that would drop it.
    function test_TheRequiredRoleVetoesTheChangeThatDropsIt() public {
        governance = deploy(_requiringC(both(ROLE_A, ROLE_B), ALL));
        uint256 drop = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        cancelAdmin(drop, C);
        assertAdminState(drop, IGovernanceTypes.ProposalState.CANCELLED);
        assertEq(
            RoleSet.unwrap(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE).requiredRoleMask),
            RoleSet.unwrap(only(ROLE_C))
        );
    }

    /// Rule changes cannot lose the required role's veto, and a decision
    /// cannot require a role that rule changes do not hear.
    function test_RevertWhen_AChangeWouldLeaveARequiredRoleUnheard() public {
        governance = deploy(_requiringC(both(ROLE_A, ROLE_B), ALL));
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));

        governance = deploy(_allPolicies(both(ROLE_A, ROLE_B), DAY));
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), both(ROLE_A, ROLE_B), DAY));
    }

    /// Every status policy alike; the veto of the required role alone is enough.
    function test_EveryRequiredRoleIsCoveredAndTheBoundaryHolds() public {
        for (uint8 kind = 0; kind < uint8(IGovernanceTypes.PolicyKind.ADMIN); kind++) {
            IGovernanceTypes.Policy[4] memory policies = _allPolicies(only(ROLE_A), DAY);
            policies[kind].requiredRoleMask = only(ROLE_C);
            vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
            deploy(policies);

            policies[3].vetoRoleMask = both(ROLE_A, ROLE_C);
            governance = deploy(policies);
            _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, only(ROLE_A), DAY));
        }
    }

    /// Every required role, not one of them.
    function test_RevertWhen_OneOfTwoRequiredRolesIsUnheard() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(only(ROLE_A), DAY);
        policies[uint8(IGovernanceTypes.PolicyKind.REVOKE)].requiredRoleMask = both(ROLE_B, ROLE_C);
        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].vetoRoleMask = both(ROLE_A, ROLE_C);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(policies);

        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].vetoRoleMask = ALL;
        governance = deploy(policies);
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
    }

    /// Each passes alone; the second is refused at execution.
    function test_RevertWhen_TwoApprovedChangesTogetherLeaveARequiredRoleUnheard() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(both(ROLE_A, ROLE_B), DAY);
        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].vetoRoleMask = ALL;
        governance = deploy(policies);
        uint256 narrow = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        uint256 require_ =
            setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), both(ROLE_A, ROLE_B), DAY));
        applyAdmin(narrow);
        vm.warp(governance.getAdminProposal(require_).executableAt);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        executeAdmin(require_, A);
    }

    // -----------------------------------------------------------------------
    // A required role needs a timelock on rule changes to veto in
    // -----------------------------------------------------------------------

    /// With no timelock anywhere, a rule change would apply at its quorum and
    /// drop C's requirement before C could veto. A second of it is enough.
    function test_RevertWhen_ARequiredRoleHasNoTimeToVeto() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(ALL, 0);
        policies[uint8(IGovernanceTypes.PolicyKind.REINSTATE)].requiredRoleMask = only(ROLE_C);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        deploy(policies);

        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].timelock = 1;
        governance = deploy(policies);
        uint256 drop = setPolicy(A, B, IGovernanceTypes.PolicyKind.REINSTATE, policy(2, NONE, ALL, 0));
        assertAdminState(drop, IGovernanceTypes.ProposalState.APPROVED);
        cancelAdmin(drop, C);
        assertAdminState(drop, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// Neither side moves past it: ADMIN cannot drop its timelock while a
    /// role is required, and nothing new is required while it has none.
    function test_RevertWhen_AChangeWouldLeaveARequiredRoleNoTime() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(ALL, 0);
        policies[uint8(IGovernanceTypes.PolicyKind.REINSTATE)].requiredRoleMask = only(ROLE_C);
        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].timelock = 1;
        governance = deploy(policies);
        _expectRefused(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 0));

        governance = deploy(_allPolicies(ALL, 0));
        _expectRefused(IGovernanceTypes.PolicyKind.SUSPEND, policy(2, only(ROLE_C), ALL, 0));
    }

    /// Each passes alone; the second is refused at execution.
    function test_RevertWhen_TwoApprovedChangesTogetherLeaveARequiredRoleNoTime() public {
        IGovernanceTypes.Policy[4] memory policies = _allPolicies(ALL, 0);
        policies[uint8(IGovernanceTypes.PolicyKind.ADMIN)].timelock = 1;
        governance = deploy(policies);
        uint256 instant = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 0));
        uint256 require_ = setPolicy(A, B, IGovernanceTypes.PolicyKind.REINSTATE, policy(2, only(ROLE_C), ALL, 0));
        applyAdmin(instant);
        vm.warp(governance.getAdminProposal(require_).executableAt);
        vm.expectRevert(IGovernanceTypes.AdminPolicyTooWeak.selector);
        executeAdmin(require_, A);
    }

    // -----------------------------------------------------------------------
    // A TI set up before the rule, under the old pilot (ADMIN without delay)
    // -----------------------------------------------------------------------

    /// A TI from the old pilot (ADMIN without delay) must raise ADMIN first.
    function test_ATiSetUpBeforeTheRuleRaisesItsRuleChangesFirst() public {
        _forgeLegacyAdminWithoutDelay();
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN).timelock, 0);

        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, DAY));
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

    /// Sets ADMIN's timelock to 0 in storage, as the old pilot did.
    function _forgeLegacyAdminWithoutDelay() private {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.TiConfiguration")) - 1)) & ~bytes32(uint256(0xff));
        // TiConfig slot 4 + ADMIN (3); timelock above the three role bytes.
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

    /// Revocations require C; status policies veto with `veto`, ADMIN with `adminVeto`.
    function _requiringC(RoleSet veto, RoleSet adminVeto) private view returns (IGovernanceTypes.Policy[4] memory p) {
        p = _allPolicies(veto, DAY);
        p[uint8(IGovernanceTypes.PolicyKind.REVOKE)].requiredRoleMask = only(ROLE_C);
        p[uint8(IGovernanceTypes.PolicyKind.ADMIN)].vetoRoleMask = adminVeto;
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
