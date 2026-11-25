pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// A TI accredited again starts over: what it had open before ends.
contract TiReaccreditationTest is GovernanceTest {
    bytes32 internal constant NEW_ATTRIBUTE = keccak256("new ti attribute");
    bytes32 internal constant THIRD_ATTRIBUTE = keccak256("third ti attribute");

    /// Audit: a revocation approved before the TI lost its accreditation
    /// executed at once when the TAO moved it to a new one.
    function test_RevertWhen_ARevocationOutlivesTheTisAccreditation() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _revokeTheTi();
        skip(DAY);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.execute(id);

        _accreditAgain();
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
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

    /// Nothing is opened while the TI is not accredited.
    function test_RevertWhen_AnUnaccreditedTiProposes() public {
        _revokeTheTi();
        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        vm.stopPrank();
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

    /// Anyone expires an ended proposal, which frees its certificate.
    function test_AnyoneExpiresAProposalTheRestorationEnded() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _revokeTheTi();
        _accreditAgain();
        vm.prank(outsider);
        governance.expireProposal(id);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
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
