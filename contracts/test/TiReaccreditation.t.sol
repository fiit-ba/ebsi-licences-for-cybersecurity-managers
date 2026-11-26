pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// A TI accredited again decides again what would raise trust or change its
/// rules; what lowers trust goes on, as it could without accreditation.
contract TiReaccreditationTest is GovernanceTest {
    bytes32 internal constant NEW_ATTRIBUTE = keccak256("new ti attribute");
    bytes32 internal constant THIRD_ATTRIBUTE = keccak256("third ti attribute");

    /// A reinstatement approved before the TI lost its accreditation neither
    /// executes without it nor outlives its return.
    function test_RevertWhen_AReinstatementOutlivesTheTisAccreditation() public {
        uint256 id = _approvedReinstatement();
        _revokeTheTi();
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.execute(id);

        _accreditAgain();
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// A revocation approved before goes on, through the loss and the return.
    function test_ARevocationOutlivesTheTisAccreditation() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _revokeTheTi();
        _accreditAgain();
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        skip(DAY);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    function test_RevertWhen_ARuleChangeOutlivesTheTisAccreditation() public {
        uint256 id = setTtl(A, B, pilotTtl + DAY);
        _revokeTheTi();
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.executeAdminProposal(id);
        _accreditAgain();
        assertAdminState(id, IGovernanceTypes.ProposalState.EXPIRED);
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.executeAdminProposal(id);
    }

    /// Moving a TI that is still accredited ends nothing.
    function test_MovingAnAccreditedTiEndsNothing() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _accreditAgain();
        skip(DAY);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// Without accreditation, only what lowers trust is opened.
    function test_AnUnaccreditedTiOpensOnlyWhatLowersTrust() public {
        vm.prank(A);
        registry.suspendNow(OTHER_CERTIFICATE, REASON_GIVEN);
        _revokeTheTi();
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(TI_ID, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        vm.stopPrank();
        propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
    }

    /// Documented: a revoked TAO whose chain the registry repairs under the
    /// same attribute brings the TI back without a call to this contract, so
    /// its old decisions go on. A veto still stops them.
    function test_ATaoChainRepairedInTheRegistryLeavesProposalsOpen() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        issuers.accredit(taoDid, TAO_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, ROOT_DID, ROOT_ATTRIBUTE);
        assertFalse(governance.isActiveTi(TI_DID, TI_ATTRIBUTE));
        issuers.accredit(taoDid, TAO_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TAO, ROOT_DID, ROOT_ATTRIBUTE);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);

        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A proposal opened after the restoration runs as usual, and a later
    /// move of the accredited TI does not end it.
    function test_AProposalOpenedAfterTheRestorationRuns() public {
        _revokeTheTi();
        _accreditAgain();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        issuers.accredit(TI_DID, THIRD_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, THIRD_ATTRIBUTE);
        sign(id, B);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// A move the contract refuses ends nothing.
    function test_ARefusedMoveEndsNothing() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _revokeTheTi();
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// The veto holds while the TI is not accredited.
    function test_AVetoStopsADecisionWhileTheTiIsNotAccredited() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _revokeTheTi();
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// Anyone expires an ended reinstatement, which frees its certificate.
    function test_AnyoneExpiresAProposalTheRestorationEnded() public {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        _revokeTheTi();
        _accreditAgain();
        vm.prank(outsider);
        governance.expireProposal(id);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
    }

    function _approvedReinstatement() internal returns (uint256 id) {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        sign(id, B);
    }

    function _revokeTheTi() internal {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        assertFalse(governance.isActiveTi(TI_DID, TI_ATTRIBUTE));
    }

    function _accreditAgain() internal {
        issuers.accredit(TI_DID, NEW_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE);
    }
}
