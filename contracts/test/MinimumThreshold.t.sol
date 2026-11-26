pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";

/// Every policy needs at least two roles: no single key decides. Only the
/// reversible suspension at once takes one signature.
contract MinimumThresholdTest is GovernanceTest {
    /// Audit: the TAO set a TI up with a policy of one role.
    function test_RevertWhen_TheTaoSetsUpAPolicyOfOneRole() public {
        for (uint8 kind = 0; kind < 4; kind++) {
            vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
            deploy(pilotWith(IGovernanceTypes.PolicyKind(kind), policy(1, NONE, ALL, 0)));
        }
    }

    /// Audit: the TI's quorum lowered a policy to one role.
    function test_RevertWhen_TheQuorumLowersAPolicyToOneRole() public {
        for (uint8 kind = 0; kind < 4; kind++) {
            vm.prank(A);
            vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
            governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind(kind), 1, NONE, ALL, DAY);
        }
        assertEq(governance.adminProposalCount(), 0);
    }

    /// Nor zero.
    function test_RevertWhen_TheThresholdIsZero() public {
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        deploy(pilotWith(IGovernanceTypes.PolicyKind.SUSPEND, policy(0, NONE, ALL, 0)));
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.SUSPEND, 0, NONE, ALL, 0);
    }

    /// Two is the floor, at set-up and through a rule change.
    function test_TwoRolesAreTheFloor() public {
        assertEq(governance.MIN_THRESHOLD(), 2);
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].threshold = 3;
        }
        governance = deploy(policies);
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(2, NONE, ALL, 0));
        signAdmin(id, C);
        applyAdmin(id);
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.SUSPEND).threshold, 2);
    }

    /// One key alone revokes nothing and changes no rule; it still suspends
    /// at once, which is reversible.
    function test_OneKeyAloneOnlySuspendsAtOnce() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        vm.prank(A);
        uint256 rule = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        assertAdminState(rule, IGovernanceTypes.ProposalState.PROPOSED);

        vm.prank(A);
        registry.suspendNow(OTHER_CERTIFICATE, REASON_GIVEN);
        assertEq(
            uint8(registry.certificateStatus(OTHER_CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED)
        );
    }

    /// Two keys of one role are one role: a TI needs two roles, its own or a
    /// cosigner's.
    function test_RevertWhen_TheTiHasOneRoleOnly() public {
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        deploy(keys(A, B), roles(ROLE_A, ROLE_A), pilotPolicies(), pilotTtl);
    }

    /// One role of its own and a cosigner's make two; one alone does not.
    function test_OneOwnRoleAndACosignerMeetTheFloor() public {
        string memory other = "did:ebsi:zOtherTi";
        accreditTi(other);
        address[] memory one = new address[](1);
        one[0] = spare;
        Role[] memory itsRole = new Role[](1);
        itsRole[0] = ROLE_A;
        IGovernanceTypes.TiSetup memory s = setup(other, one, itsRole, pilot, pilotTtl);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        governance.addTi(s);

        s.cosigners = new IGovernanceTypes.Cosigner[](1);
        s.cosigners[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", ROLE_C);
        vm.prank(tao);
        bytes32 otherId = governance.addTi(s);
        assertEq(governance.getPolicy(otherId, IGovernanceTypes.PolicyKind.REVOKE).threshold, 2);
    }
}
