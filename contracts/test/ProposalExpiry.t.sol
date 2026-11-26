pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {RoleSet} from "../contracts/libraries/Roles.sol";

/// The views return the end of the lifetime a proposal opened with.
contract ProposalExpiryTest is GovernanceTest {
    uint64 internal constant SHORTER = 7 days;

    /// The fields a decoder from before `expiresAt` reads.
    struct ProposalViewBefore {
        bytes32 tiId;
        bytes32 statusKey;
        IGovernanceTypes.ActionType actionType;
        bytes32 reasonHash;
        uint64 proposedAt;
        uint64 quorumReachedAt;
        IGovernanceTypes.ProposalState state;
        address[] signatures;
        uint64 executableAt;
        RoleSet rolesSignedMask;
        address proposer;
    }

    /// Audit: after a shorter lifetime, the estimate said expired while the
    /// proposal was open and could not be expired. The view tells the truth.
    function test_TheViewKeepsTheLifetimeTheProposalOpenedWith() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint64 expiresAt = governance.getProposal(id).proposedAt + pilotTtl;
        assertEq(governance.getProposal(id).expiresAt, expiresAt);

        applyAdmin(setTtl(A, B, SHORTER));
        uint64 estimate = governance.getProposal(id).proposedAt + SHORTER;
        vm.warp(estimate);
        assertEq(governance.getProposal(id).expiresAt, expiresAt, "unchanged");
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);
        _expiresExactlyAt(id, expiresAt);
    }

    /// The same for a rule change.
    function test_TheAdminViewKeepsTheLifetimeTooAndIsExact() public {
        IGovernanceTypes.Policy memory same = pilot[uint8(IGovernanceTypes.PolicyKind.SUSPEND)];
        vm.prank(A);
        uint256 rule = governance.proposePolicy(
            TI_ID, IGovernanceTypes.PolicyKind.SUSPEND, same.threshold, same.requiredRoleMask, same.vetoRoleMask, 0
        );
        uint64 expiresAt = governance.getAdminProposal(rule).proposedAt + pilotTtl;
        applyAdmin(setTtl(A, B, SHORTER));
        assertEq(governance.getAdminProposal(rule).expiresAt, expiresAt);

        vm.warp(expiresAt - 1);
        assertAdminState(rule, IGovernanceTypes.ProposalState.PROPOSED);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireAdminProposal(rule);

        vm.warp(expiresAt);
        assertAdminState(rule, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(C);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signAdminProposal(rule);
        vm.prank(outsider);
        governance.expireAdminProposal(rule);
    }

    /// A longer lifetime later does not extend it either; a proposal opened
    /// after the change gets the new one.
    function test_ALaterLifetimeAppliesOnlyToLaterProposals() public {
        uint256 before = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint64 expiresAt = governance.getProposal(before).expiresAt;
        applyAdmin(setTtl(A, B, pilotTtl + 10 * DAY));
        assertEq(governance.getProposal(before).expiresAt, expiresAt);

        uint256 later = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        assertEq(governance.getProposal(later).expiresAt, vm.getBlockTimestamp() + pilotTtl + 10 * DAY);
        _expiresExactlyAt(before, expiresAt);
    }

    /// `state` is authoritative: a proposal the standing overtook reads
    /// expired before its `expiresAt`.
    function test_AnOvertakenProposalEndsBeforeItsExpiry() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertGt(governance.getProposal(id).expiresAt, vm.getBlockTimestamp());
    }

    /// So does a rule change a cosigner change ended.
    function test_ARuleChangeACosignerChangeEndedEndsBeforeItsExpiry() public {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", ROLE_C);
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        uint256 rule = setTtl(A, B, pilotTtl + DAY);
        vm.prank(tao);
        governance.setCosigners(TI_ID, new IGovernanceTypes.Cosigner[](0));
        assertAdminState(rule, IGovernanceTypes.ProposalState.EXPIRED);
        assertGt(governance.getAdminProposal(rule).expiresAt, vm.getBlockTimestamp());
    }

    /// Decided proposals keep the value they opened with.
    function test_DecidedProposalsKeepTheirExpiry() public {
        uint256 executed = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint64 expiresAt = governance.getProposal(executed).expiresAt;
        sign(executed, B);
        execute(executed, A);
        uint256 cancelled = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        cancel(cancelled, A, REASON);
        assertEq(governance.getProposal(executed).expiresAt, expiresAt);
        assertEq(governance.getProposal(cancelled).expiresAt, expiresAt);
        skip(pilotTtl);
        assertState(executed, IGovernanceTypes.ProposalState.EXECUTED);
        assertState(cancelled, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A ballot opened before `expiresAt` was stored reads 0 and never lapses
    /// by time, as before.
    function test_ABallotFromBeforeReadsZeroAndStaysOpen() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        bytes32 slot = bytes32(_proposalSlot(id) + 5);
        uint256 packed = uint256(vm.load(address(governance), slot));
        vm.store(address(governance), slot, bytes32(packed & ~(uint256(type(uint64).max) << 72)));
        assertEq(governance.getProposal(id).expiresAt, 0);
        skip(pilotTtl * 2);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// Appended last: a decoder of the fields before it still reads them.
    function test_ADecoderFromBeforeStillReadsTheView() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, B);
        (bool ok, bytes memory data) = address(governance).staticcall(abi.encodeCall(governance.getProposal, (id)));
        assertTrue(ok);
        ProposalViewBefore memory old = abi.decode(data, (ProposalViewBefore));
        IGovernanceTypes.ProposalView memory now_ = governance.getProposal(id);
        assertEq(old.statusKey, now_.statusKey);
        assertEq(old.proposer, now_.proposer);
        assertEq(old.signatures.length, 2);
        assertEq(old.signatures[1], B);
        assertEq(uint8(old.state), uint8(now_.state));
    }

    /// The view's `expiresAt` is exactly where the proposal stops: a second
    /// before, it is open and takes a signature; at it, it is expired.
    function _expiresExactlyAt(uint256 id, uint64 expiresAt) private {
        vm.warp(expiresAt - 1);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);
        vm.warp(expiresAt);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signProposal(id);
        vm.prank(outsider);
        governance.expireProposal(id);
    }

    function _proposalSlot(uint256 id) private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(id, uint256(location) + 2)));
    }
}
