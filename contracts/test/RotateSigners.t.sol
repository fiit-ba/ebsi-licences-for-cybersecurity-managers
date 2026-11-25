pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {SignerRotation} from "../scripts/SignerRotation.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";

/// Key rotation through rule changes (scripts/SignerRotation.sol).
contract RotateSignersTest is GovernanceTest, SignerRotation {
    address internal newA;
    address internal newB;

    function setUp() public override {
        super.setUp();
        newA = makeAddr("newA");
        newB = makeAddr("newB");
    }

    function _as(address account) internal override {
        vm.prank(account);
    }

    /// External, so a test can expect it to revert.
    function rotate(address[] memory accounts, Target[] memory target) external returns (uint256[] memory) {
        return _rotateSigners(governance, TI_ID, accounts, target);
    }

    /// Rotates, then applies once the timelock is over.
    function _rotateAndApply(address[] memory accounts, Target[] memory target) internal {
        uint256[] memory changes = this.rotate(accounts, target);
        for (uint256 i = 0; i < changes.length; i++) {
            applyAdmin(changes[i], C);
        }
    }

    function _bodyKeys() internal view returns (Target[] memory target) {
        target = new Target[](2);
        target[0] = Target(ROLE_A, newA);
        target[1] = Target(ROLE_B, newB);
    }

    function test_ReplacesTheBodysKeysRoleByRoleAndKeepsTheSupervisoryAuthoritys() public {
        _rotateAndApply(keys(A, B, C), _bodyKeys());
        address[] memory signers = governance.getTi(TI_ID).signers;
        assertEq(signers.length, 3);
        assertTrue(governance.isSigner(TI_ID, newA) && governance.isSigner(TI_ID, newB) && governance.isSigner(TI_ID, C));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, newA)), Role.unwrap(ROLE_A));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, newB)), Role.unwrap(ROLE_B));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, C)), Role.unwrap(ROLE_C));
    }

    function test_GoesThroughTheRuleChangeQuorumOneReplacementPerRole() public {
        uint256[] memory changes = this.rotate(keys(A, B, C), _bodyKeys());
        assertEq(changes.length, 2);
        assertEq(governance.adminProposalCount(), 2);
    }

    function test_IsANoOpWhenTheKeysAlreadyMatch() public {
        _rotateAndApply(keys(A, B, C), _bodyKeys());
        uint256 before = governance.adminProposalCount();
        uint256[] memory changes = this.rotate(keys(newA, newB, C), _bodyKeys());
        assertEq(changes.length, 0);
        assertEq(governance.adminProposalCount(), before);
    }

    function test_LeavesTheOldKeysSigningUntilTheRotationApplies() public {
        uint256[] memory changes = this.rotate(keys(A, B, C), _bodyKeys());
        assertFalse(governance.isSigner(TI_ID, newA));
        assertTrue(governance.isSigner(TI_ID, A));
        assertAdminState(changes[0], IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_LeavesTheOldKeysUnableToSignAnything() public {
        _rotateAndApply(keys(A, B, C), _bodyKeys());
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        propose(newA, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, newB);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_RevertWhen_AskedToRotateTheSupervisoryAuthoritysKey() public {
        Target[] memory target = new Target[](1);
        target[0] = Target(ROLE_C, newA);
        vm.expectRevert(SupervisoryKeyNotRotatable.selector);
        this.rotate(keys(A, B, C), target);
    }

    function test_RevertWhen_TheTargetGivesOneKeyToTwoRoles() public {
        Target[] memory target = new Target[](2);
        target[0] = Target(ROLE_A, newA);
        target[1] = Target(ROLE_B, newA);
        vm.expectRevert(SameKeyForTwoRoles.selector);
        this.rotate(keys(A, B, C), target);
    }

    function test_RevertWhen_RotatingBothRolesWithoutTheSupervisoryAuthority() public {
        vm.expectRevert(abi.encodeWithSelector(NotEnoughApprovers.selector, 2, 1));
        this.rotate(keys(A, B), _bodyKeys());
    }

    function test_RotatesOneRoleWithTheOtherBodyRoleAlone() public {
        Target[] memory target = new Target[](1);
        target[0] = Target(ROLE_A, newA);
        uint256[] memory changes = this.rotate(keys(A, B), target);
        applyAdmin(changes[0], B);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, newA)), Role.unwrap(ROLE_A));
    }

    function test_RevertWhen_ARequiredApproverRoleIsRotatedInTheSameRun() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, only(ROLE_B), ALL, DAY)));
        vm.expectRevert(abi.encodeWithSelector(RequiredApproversMissing.selector, only(ROLE_B)));
        this.rotate(keys(A, B, C), _bodyKeys());
    }

    function test_RevertWhen_NoAccountMayApproveForARequiredRole() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, only(ROLE_C), ALL, DAY)));
        Target[] memory target = new Target[](1);
        target[0] = Target(ROLE_A, newA);
        vm.expectRevert(abi.encodeWithSelector(RequiredApproversMissing.selector, only(ROLE_C)));
        this.rotate(keys(A, B), target);
    }

    function test_EachChangeOfARunKeepsItsQuorumWhicheverAppliesFirst() public {
        uint256[] memory changes = this.rotate(keys(A, B, C), _bodyKeys());
        assertFalse(governance.hasSignedAdmin(changes[0], B), "A's change: not signed by B");
        assertFalse(governance.hasSignedAdmin(changes[1], A), "B's change: not signed by A");
        applyAdmin(changes[1], C);
        applyAdmin(changes[0], C);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, newA)), Role.unwrap(ROLE_A));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, newB)), Role.unwrap(ROLE_B));
    }

    function test_StopsWhenItCannotMusterAQuorumRatherThanHalfRotating() public {
        vm.expectRevert(abi.encodeWithSelector(NotEnoughApprovers.selector, 2, 1));
        this.rotate(keys(A, outsider), _bodyKeys());
        assertFalse(governance.isSigner(TI_ID, newA));
    }
}
