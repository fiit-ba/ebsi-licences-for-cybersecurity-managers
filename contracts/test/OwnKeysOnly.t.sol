pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// Registering and suspending at once are the TI's own acts: only its own
/// keys do them, never a cosigner's.
contract OwnKeysOnlyTest is GovernanceTest {
    string internal constant NBU = "did:ebsi:zSupervisor";
    string internal constant OTHER_TI = "did:ebsi:zOtherTi";
    bytes32 internal constant NEW_ID = keccak256("new id");
    bytes32 internal constant FORGED = keccak256("forged credential");
    address internal supervisor;

    function setUp() public override {
        super.setUp();
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(NBU, ROLE_C);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        supervisor = cosignerKey(NBU);
    }

    /// Audit: a cosigner's key suspended the TI's licence alone, and again
    /// after each reinstatement.
    function test_RevertWhen_ACosignerKeySuspends() public {
        vm.prank(supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        _assertStanding(IGovernanceTypes.Standing.VALID);
    }

    /// Audit: a cosigner's key registered the TI's id first, with a hash the
    /// TI never issued, and the TI's own registration failed for good.
    function test_RevertWhen_ACosignerKeyRegistersForTheTi() public {
        vm.prank(supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, FORGED, IGovernanceTypes.Standing.SUSPENDED);

        vm.prank(A);
        bytes32 statusKey =
            registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        assertEq(registry.certificateStatus(statusKey).credentialHash, CREDENTIAL_HASH);
    }

    /// Every own key, whatever its role.
    function test_EachOwnKeyRegistersAndSuspends() public {
        vm.prank(B);
        bytes32 statusKey =
            registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.prank(B);
        registry.suspendNow(statusKey, REASON_GIVEN);
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        _assertStanding(IGovernanceTypes.Standing.SUSPENDED);
    }

    /// Another TI's own key is not this TI's.
    function test_RevertWhen_AnotherTisKeyActs() public {
        accreditTi(OTHER_TI);
        vm.prank(tao);
        governance.addTi(setup(OTHER_TI, keys(spare, C), roles(ROLE_A, ROLE_B), pilot, pilotTtl));
        vm.startPrank(spare);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, FORGED, IGovernanceTypes.Standing.VALID);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        registry.registerCertificate(NEW_ID, OTHER_TI, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.stopPrank();
    }

    /// Audit: a TI named as another's cosigner signs there, and nothing more.
    function test_ATiNamedAsAnothersCosignerOnlySignsThere() public {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        accreditTi(OTHER_TI);
        IGovernanceTypes.TiSetup memory other = setup(OTHER_TI, keys(spare, C), roles(ROLE_A, ROLE_B), pilot, pilotTtl);
        other.cosigners = new IGovernanceTypes.Cosigner[](1);
        other.cosigners[0] = IGovernanceTypes.Cosigner(TI_DID, ROLE_C);
        vm.prank(tao);
        bytes32 otherId = governance.addTi(other);
        vm.prank(spare);
        bytes32 statusKey =
            registry.registerCertificate(NEW_ID, OTHER_TI, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        assertEq(Role.unwrap(governance.roleOf(otherId, A)), Role.unwrap(ROLE_C), "A is a cosigner there");

        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(statusKey, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(keccak256("other id"), OTHER_TI, 1, 0, FORGED, IGovernanceTypes.Standing.SUSPENDED);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAction(otherId, statusKey, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.stopPrank();

        vm.prank(spare);
        uint256 id = governance.proposeAction(otherId, statusKey, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, A);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }

    /// Audit: the quorum reinstates, and a cosigner cannot suspend again.
    function test_RevertWhen_ACosignerSuspendsAgainAfterAReinstatement() public {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        sign(id, B);
        execute(id, A);
        _assertStanding(IGovernanceTypes.Standing.VALID);
        vm.prank(supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        _assertStanding(IGovernanceTypes.Standing.VALID);
    }

    /// A TI key the cosigner's DID lists later keeps its TI role: it stays
    /// the TI's own key.
    function test_ATiKeyTheCosignersDidListsStaysTheTis() public {
        StubDidRegistry(didRegistry).setController(NBU, A, true);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, A)), Role.unwrap(ROLE_A));
        governance.requireActiveOwnSigner(TI_ID, A);
        vm.startPrank(A);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.stopPrank();
        _assertStanding(IGovernanceTypes.Standing.SUSPENDED);
    }

    /// The TI's DID listing a key does not make it a signer.
    function test_RevertWhen_AKeyTheTisDidListsIsNoSigner() public {
        assertTrue(governance.isActiveTi(TI_DID, TI_ATTRIBUTE));
        vm.startPrank(outsider);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, FORGED, IGovernanceTypes.Standing.VALID);
        vm.stopPrank();
    }

    /// A signer key the DID Registry no longer lists for the TI is refused.
    function test_RevertWhen_AnOwnKeyIsNoLongerListed() public {
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(TI_DID, A, false);
        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.stopPrank();
    }

    /// A removed key is refused.
    function test_RevertWhen_ARemovedKeyActs() public {
        applyAdmin(removeSigner(A, supervisor, B));
        vm.startPrank(B);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.stopPrank();
    }

    /// A TI that lost its accreditation still withdraws its licences, but
    /// records none; a cosigner's key does neither.
    function test_AnUnaccreditedTiSuspendsButDoesNotRegister() public {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        vm.prank(supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);

        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        _assertStanding(IGovernanceTypes.Standing.SUSPENDED);
    }

    /// An id under a DID no TI was set up for.
    function test_RevertWhen_TheDidIsNoTi() public {
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        registry.registerCertificate(NEW_ID, "did:ebsi:zNobody", 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    /// The cosigner keeps its part in the decisions: it signs and vetoes.
    function test_ACosignerStillSignsAndVetoes() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, supervisor);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        cancel(id, supervisor, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);

        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        signAdmin(rule, supervisor);
        assertAdminState(rule, IGovernanceTypes.ProposalState.APPROVED);
        cancelAdmin(rule, supervisor);
        assertAdminState(rule, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// R6: a cosigner's key opens nothing, neither a status proposal nor any
    /// rule change; the TI's own key does.
    function test_RevertWhen_ACosignerKeyProposes() public {
        vm.startPrank(supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeRemoveSigner(TI_ID, B);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeReplaceSigner(TI_ID, B, spare);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE, 2, NONE, ALL, DAY);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        vm.stopPrank();
        assertEq(governance.adminProposalCount(), 0);

        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.prank(B);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// A removed key and a replaced one lose their role and are no own key;
    /// the replacement is.
    function test_RemovingOrReplacingAKeyClearsItsRole() public {
        address next = makeAddr("next");
        applyAdmin(replaceSigner(A, supervisor, B, next));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, B)), 0, "the replaced key");
        assertTrue(governance.retired(TI_ID, B));
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(TI_ID, B);
        governance.requireActiveOwnSigner(TI_ID, next);

        applyAdmin(removeSigner(A, supervisor, next));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, next)), 0, "the removed key");
        assertTrue(governance.retired(TI_ID, next));
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(TI_ID, next);
        vm.prank(next);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    /// The checks without the TIR and with it, for a TI that lost its
    /// accreditation and for an own key the DID Registry no longer lists.
    function test_TheChecksForAnUnaccreditedTiAndAnUnlistedKey() public {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        governance.requireOwnSigner(TI_ID, A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.requireActiveOwnSigner(TI_ID, A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireActiveOwnSigner(TI_ID, supervisor);

        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(TI_DID, A, false);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(TI_ID, A);
        governance.requireOwnSigner(TI_ID, B);
    }

    /// The checks themselves, as the registry and the back-office ask them.
    function test_TheChecks() public {
        governance.requireOwnSigner(TI_ID, A);
        governance.requireActiveOwnSigner(TI_ID, B);
        governance.requireSigner(TI_ID, supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(TI_ID, supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireActiveOwnSigner(TI_ID, supervisor);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(keccak256("no such ti"), A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.requireOwnSigner(TI_ID, address(0));
    }

    function _assertStanding(IGovernanceTypes.Standing expected) private view {
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(expected));
    }
}
