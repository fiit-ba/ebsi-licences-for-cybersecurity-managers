pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// Under a narrowed veto, a proposal whose proposer holds no role, and that no
/// quorum of live keys backs, is closed by any signer of the TI.
contract OrphanProposalsTest is GovernanceTest {
    Role internal constant ROLE_D = Role.wrap(4);
    address internal D;

    function setUp() public override {
        super.setUp();
        D = makeAddr("D");
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].vetoRoleMask = only(ROLE_C);
        }
        address[] memory signers = new address[](4);
        (signers[0], signers[1], signers[2], signers[3]) = (A, B, C, D);
        Role[] memory signerRoles = new Role[](4);
        (signerRoles[0], signerRoles[1], signerRoles[2], signerRoles[3]) = (ROLE_A, ROLE_B, ROLE_C, ROLE_D);
        governance = deploy(signers, signerRoles, policies, pilotTtl);
    }

    /// Audit: a removed key's junk reinstatement blocked its licence; no other
    /// signer could open a proposal for it or close the junk.
    function test_ARemovedKeysJunkIsClosedByAnotherSigner() public {
        uint256 junk = _junkReinstatement();
        applyAdmin(removeSigner(B, D, A));
        assertState(junk, IGovernanceTypes.ProposalState.PROPOSED);

        cancel(junk, B, REASON);
        assertState(junk, IGovernanceTypes.ProposalState.CANCELLED);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
        propose(B, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
    }

    /// The same after a replacement, and for a proposer the DID Registry
    /// no longer lists; listed again, its proposal is its own again.
    function test_AnOrphanOfAReplacedOrUnlistedKey() public {
        uint256 junk = _junkReinstatement();
        applyAdmin(replaceSigner(B, D, A, spare));
        cancel(junk, spare, REASON);
        assertState(junk, IGovernanceTypes.ProposalState.CANCELLED);

        uint256 other = propose(B, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _listForTheTi(B, false);
        _listForTheTi(B, true);
        vm.prank(D);
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        governance.cancelProposal(other, REASON);
        _listForTheTi(B, false);
        cancel(other, D, REASON);
        assertState(other, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A proposal a quorum of live keys still backs stands: only the veto stops it.
    function test_AnOrphanAQuorumStillBacksStands() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        sign(id, D);
        applyAdmin(removeSigner(B, D, A));
        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        governance.cancelProposal(id, REASON);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// While the proposer holds its role, others cannot close it.
    function test_RevertWhen_AnotherSignerClosesALiveKeysProposal() public {
        uint256 id = _junkReinstatement();
        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        governance.cancelProposal(id, REASON);
    }

    /// Only a signer closes an orphan, a cosigner's key included; an outsider
    /// cannot.
    function test_OnlyASignerClosesAnOrphan() public {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerE", Role.wrap(5));
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        uint256 junk = _junkReinstatement();
        applyAdmin(removeSigner(B, D, A));
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(junk, REASON);

        cancel(junk, cosignerKey("did:ebsi:zCosignerE"), REASON);
        assertState(junk, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The same for a rule change.
    function test_AnOrphanRuleChangeIsClosedByAnotherSigner() public {
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        applyAdmin(removeSigner(B, D, A));
        vm.prank(B);
        governance.cancelAdminProposal(rule);
        assertAdminState(rule, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function _junkReinstatement() private returns (uint256 id) {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, NO_REASON);
    }

    function _listForTheTi(address key, bool listed) private {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, D, true);
        StubDidRegistry(didRegistry).setController(TI_DID, spare, true);
        StubDidRegistry(didRegistry).setController(TI_DID, key, listed);
    }
}
