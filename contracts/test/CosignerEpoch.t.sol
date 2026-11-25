pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {Role} from "../contracts/libraries/Roles.sol";

/// A change of cosigners ends every open proposal of the TI.
contract CosignerEpochTest is GovernanceTest {
    string internal constant NBU = "did:ebsi:zSupervisor";
    string internal constant SECOND = "did:ebsi:zCosigner";

    function setUp() public override {
        super.setUp();
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        _cosigners(NBU, ROLE_C);
    }

    /// Audit: the TAO removed NBÚ while a rule change taking C's veto waited,
    /// executed it, and named NBÚ again.
    function test_RevertWhen_ARuleChangeOutlivesTheSupervisorsRemoval() public {
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, both(ROLE_A, ROLE_B), DAY));
        _noCosigners();
        assertAdminState(id, IGovernanceTypes.ProposalState.EXPIRED);
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.executeAdminProposal(id);
        _cosigners(NBU, ROLE_C);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.executeAdminProposal(id);
    }

    /// Audit: the same during a revocation's timelock.
    function test_RevertWhen_ARevocationOutlivesTheSupervisorsRemoval() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _noCosigners();
        skip(DAY);
        _cosigners(NBU, ROLE_C);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Adding a cosigner ends them too: its key could complete a decision
    /// one TI key opened.
    function test_AddingACosignerEndsTheOpenProposals() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        address added = cosignerKey(SECOND);
        _two(NBU, SECOND);
        vm.prank(added);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signProposal(id);
    }

    function test_ChangingACosignersRoleEndsTheOpenProposals() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _cosigners(NBU, Role.wrap(4));
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// The same list changes nothing; the same DIDs in another order do.
    function test_OnlyAChangedListEndsThem() public {
        _two(NBU, SECOND);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _two(NBU, SECOND);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        _two(SECOND, NBU);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    function test_AProposalOpenedAfterTheChangeRunsAsUsual() public {
        _noCosigners();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, B);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// Each TI has its own epoch.
    function test_AnotherTisProposalsGoOn() public {
        string memory other = "did:ebsi:zOtherTi";
        accreditTi(other);
        vm.prank(tao);
        bytes32 otherId = governance.addTi(setup(other, keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilot, pilotTtl));
        vm.prank(A);
        uint256 id = governance.proposeProposalTtl(otherId, pilotTtl + DAY);
        _noCosigners();
        assertAdminState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// An ended proposal is not cancelled, but anyone expires it, and the
    /// next proposal for its certificate replaces it.
    function test_AnEndedProposalIsExpiredNotCancelled() public {
        uint256 status = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint256 other = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint256 rule = setTtl(A, B, pilotTtl + DAY);
        _noCosigners();

        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.cancelProposal(status, REASON);
        vm.startPrank(outsider);
        governance.expireProposal(status);
        governance.expireAdminProposal(rule);
        vm.stopPrank();
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
        assertAdminState(rule, IGovernanceTypes.ProposalState.EXPIRED);

        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(other, OTHER_CERTIFICATE);
        propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    /// Other changes of the TI do not end its proposals.
    function test_OtherChangesLeaveThemOpen() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE);
        applyAdmin(setTtl(A, B, pilotTtl + DAY));
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        sign(id, B);
        execute(id, A);
    }

    /// An ended rule change takes no signature either, and reads as expired.
    function test_AnEndedRuleChangeTakesNoSignature() public {
        vm.prank(A);
        uint256 id = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        _noCosigners();
        assertEq(uint8(governance.getAdminProposal(id).state), uint8(IGovernanceTypes.ProposalState.EXPIRED));
        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signAdminProposal(id);
    }

    /// Decided proposals keep their state.
    function test_DecidedProposalsKeepTheirState() public {
        uint256 executed = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(executed, B);
        execute(executed, A);
        uint256 withdrawn = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        cancel(withdrawn, A, REASON);
        _noCosigners();
        assertState(executed, IGovernanceTypes.ProposalState.EXECUTED);
        assertState(withdrawn, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A proposal opened between two changes ends with the second.
    function test_AProposalOpenedBetweenTwoChangesEndsWithTheSecond() public {
        _noCosigners();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        _cosigners(NBU, ROLE_C);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// A change the contract refuses ends nothing.
    function test_ARefusedChangeEndsNothing() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(NBU, ROLE_A);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        governance.setCosigners(TI_ID, list);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// No cosigners replaced by none changes nothing.
    function test_NoCosignersReplacedByNoneEndsNothing() public {
        _noCosigners();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _noCosigners();
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// Another DID in the same role is a change.
    function test_AnotherDidInTheSameRoleEndsThem() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _cosigners(SECOND, ROLE_C);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// The TI's epoch packs beside its lifetime and version, a ballot's
    /// beside its expiry: both in bytes that were zero, so nothing moves.
    function test_TheEpochsTakeBytesThatWereFree() public {
        _noCosigners();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint256 ti = uint256(keccak256(abi.encode(TI_ID, _location("plr.storage.TiConfiguration"))));
        assertEq(uint64(uint256(vm.load(address(governance), bytes32(ti + 8))) >> 128), 2, "TI epoch");
        // Ballot from the proposal's slot 3; its third slot: quorumReachedAt,
        // state, expiresAt, epoch.
        uint256 proposal = uint256(keccak256(abi.encode(id, uint256(_location("plr.storage.StatusProposals")) + 2)));
        uint256 slot = uint256(vm.load(address(governance), bytes32(proposal + 5)));
        assertEq(uint64(slot >> 72), governance.getProposal(id).proposedAt + pilotTtl, "expiresAt");
        assertEq(uint64(slot >> 136), 2, "ballot epoch");
        assertEq(uint256(vm.load(address(governance), bytes32(proposal + 9))), 0, "nothing after signedAs");
    }

    function _location(string memory id) private pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function _two(string memory first, string memory second) private {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](2);
        list[0] = IGovernanceTypes.Cosigner(first, ROLE_C);
        list[1] = IGovernanceTypes.Cosigner(second, ROLE_C);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }

    function _cosigners(string memory did, Role role) internal {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(did, role);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }

    function _noCosigners() internal {
        vm.prank(tao);
        governance.setCosigners(TI_ID, new IGovernanceTypes.Cosigner[](0));
    }
}
