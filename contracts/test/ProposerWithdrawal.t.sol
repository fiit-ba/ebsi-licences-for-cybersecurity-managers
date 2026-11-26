pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// A proposer withdraws its proposal only while its key still holds a role;
/// a proposal it can no longer withdraw still ends: by a veto, by expiry, or
/// by the next proposal for its certificate.
contract ProposerWithdrawalTest is GovernanceTest {
    function setUp() public override {
        super.setUp();
        // The veto belongs to C alone, so only the proposer's withdrawal is
        // open to A and B.
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].vetoRoleMask = only(ROLE_C);
        }
        governance = deploy(policies);
    }

    /// A removed proposer no longer withdraws, neither a status proposal nor
    /// a rule change.
    function test_RevertWhen_ARemovedProposerWithdraws() public {
        uint256 id = _approvedRevocation();
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        applyAdmin(removeSigner(B, C, A));
        assertTrue(governance.retired(TI_ID, A));

        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(id, REASON);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelAdminProposal(rule);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }

    /// A replaced proposer neither. With its signature gone the quorum is too,
    /// so its successor, as any signer, closes the orphan.
    function test_RevertWhen_AReplacedProposerWithdraws() public {
        uint256 id = _approvedRevocation();
        applyAdmin(replaceSigner(B, C, A, spare));
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(id, REASON);
        cancel(id, spare, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// Nor a proposer the DID Registry no longer lists; listed again, it may.
    function test_AProposerTheDidRegistryDropsWithdrawsOnlyOnceListedAgain() public {
        uint256 id = _approvedRevocation();
        _listForTheTi(A, false);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(id, REASON);

        _listForTheTi(A, true);
        cancel(id, A, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The veto still ends it: a policy always leaves a veto role a key.
    function test_TheVetoEndsWhatTheProposerCanNoLongerWithdraw() public {
        uint256 id = _approvedRevocation();
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        applyAdmin(removeSigner(B, C, A));

        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
        cancelAdmin(rule, C);
        assertAdminState(rule, IGovernanceTypes.ProposalState.CANCELLED);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
    }

    /// With no key left to veto and nobody closing it, the clock ends it:
    /// anyone expires it, and the next proposal for the certificate replaces
    /// it on its own.
    function test_TheClockEndsWhatNobodyCanCancel() public {
        uint256 id = _approvedRevocation();
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        applyAdmin(removeSigner(B, C, A));
        _listForTheTi(C, false);
        vm.prank(C);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(id, REASON);

        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);
        skip(pilotTtl);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(outsider);
        governance.expireAdminProposal(rule);
        assertAdminState(rule, IGovernanceTypes.ProposalState.EXPIRED);

        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(id, CERTIFICATE);
        propose(B, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
    }

    function _approvedRevocation() private returns (uint256 id) {
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }

    function _listForTheTi(address key, bool listed) private {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, key, listed);
    }
}
