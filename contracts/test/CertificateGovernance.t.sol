pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {IRuleChanges} from "../contracts/interfaces/IRuleChanges.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {ITiConfiguration} from "../contracts/interfaces/ITiConfiguration.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {StubDidRegistry, StubIssuersRegistry} from "./RegistryStubs.sol";

/// CertificateGovernance (component 10): construction.
contract ConstructionTest is GovernanceTest {
    function test_RecordsEachKeyWithItsRoleAndThePilotPolicies() public view {
        IGovernanceTypes.TiView memory ti = governance.getTi(TI_ID);
        address[] memory signers = ti.signers;
        Role[] memory signerRoles = ti.roles;
        assertEq(signers, keys(A, B, C));
        assertEq(signerRoles.length, 3);
        assertEq(Role.unwrap(signerRoles[0]), Role.unwrap(ROLE_A));
        assertEq(Role.unwrap(signerRoles[1]), Role.unwrap(ROLE_B));
        assertEq(Role.unwrap(signerRoles[2]), Role.unwrap(ROLE_C));
        assertEq(governance.getTi(TI_ID).rolesPresentMask, ALL, "roles present");

        IGovernanceTypes.Policy memory revoke = governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE);
        assertEq(revoke.threshold, 2);
        assertEq(revoke.requiredRoleMask, NONE, "required roles");
        assertEq(revoke.vetoRoleMask, ALL, "veto roles");
        assertEq(revoke.timelock, DAY); // 24 h, the lower end of 10.4's 24-48 h
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.SUSPEND).timelock, 0);
        assertEq(governance.getTi(TI_ID).proposalTtl, pilotTtl);
        assertEq(governance.getTi(TI_ID).version, 0);
    }

    function test_GivesTheWholeConfigurationInOneRead() public view {
        IGovernanceTypes.TiView memory config = governance.getTi(TI_ID);
        assertEq(config.signers, keys(A, B, C));
        for (uint256 i = 0; i < 4; i++) {
            assertEq(config.policies[i].threshold, 2);
        }
        assertEq(config.rolesPresentMask, ALL, "roles present");
    }

    function test_KnowsATiByTheHashOfItsDid() public view {
        assertEq(governance.computeTiId(TI_DID), TI_ID);
    }

    function test_TheTaoAddsACosignerWhoseRoleCountsAsPresent() public {
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        assertEq(governance.getTi(TI_ID).rolesPresentMask, both(ROLE_A, ROLE_B), "before");

        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", ROLE_C);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.CosignersChanged(TI_ID);
        vm.prank(tao);
        governance.setCosigners(TI_ID, cosigners);
        assertEq(governance.getTi(TI_ID).rolesPresentMask, ALL, "after");
    }

    function test_RevertWhen_ThresholdAboveTheRolesPresent() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(4, NONE, ALL, DAY));
    }

    function test_RevertWhen_ThresholdIsZero() public {
        _expectRefused(IGovernanceTypes.PolicyKind.SUSPEND, policy(0, NONE, ALL, 0));
    }

    function test_RevertWhen_ARequiredRoleHasNoKey() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, RoleSet.wrap(1 << 5), ALL, DAY));
    }

    function test_RevertWhen_MoreRequiredRolesThanTheThreshold() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(1, both(ROLE_B, ROLE_C), ALL, DAY));
    }

    function test_RevertWhen_TimelockBeyond90Days() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, 91 * DAY));
    }

    function test_RevertWhen_NobodyMayVeto() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, NONE, DAY));
    }

    function test_RevertWhen_OnlyARoleWithoutAKeyMayVeto() public {
        _expectRefused(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, RoleSet.wrap(1 << 5), DAY));
    }

    function test_RevertWhen_DuplicateKeyOrRoleOutOfRange() public {
        vm.expectRevert(IGovernanceTypes.DuplicateSigner.selector);
        deploy(keys(A, A), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);

        IGovernanceTypes.Policy memory one = policy(1, NONE, only(ROLE_A), 0);
        vm.expectRevert(IGovernanceTypes.InvalidRole.selector);
        deploy(keys(A, B), roles(ROLE_A, Role.wrap(0)), [one, one, one, one], pilotTtl);

        vm.expectRevert(IGovernanceTypes.InvalidRole.selector);
        deploy(keys(A, B), roles(ROLE_A, Role.wrap(9)), pilotPolicies(), pilotTtl);
    }

    function test_RevertWhen_NoKeyAKeyWithoutARoleOrTheZeroAddress() public {
        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        deploy(new address[](0), new Role[](0), pilotPolicies(), pilotTtl);

        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        deploy(keys(A, B, C), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);

        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        deploy(keys(A, address(0)), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
    }

    function test_RevertWhen_ACosignersRoleIsOutOfRangeOrTheTiIsUnknown() public {
        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", Role.wrap(0));
        vm.startPrank(tao);
        vm.expectRevert(IGovernanceTypes.InvalidRole.selector);
        governance.setCosigners(TI_ID, cosigners);

        cosigners[0].role = Role.wrap(9);
        vm.expectRevert(IGovernanceTypes.InvalidRole.selector);
        governance.setCosigners(TI_ID, cosigners);

        cosigners[0].role = ROLE_C;
        vm.expectRevert(IGovernanceTypes.UnknownTi.selector);
        governance.setCosigners(keccak256("did:ebsi:zUnknown"), cosigners);
        vm.stopPrank();
    }

    function test_RevertWhen_TheTiIsMovedToAnAttributeTheRegistryDoesNotShow() public {
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.setTiAttribute(TI_ID, keccak256("no such attribute"));
    }

    function test_RevertWhen_ProposalLifetimeBeyondAYear() public {
        vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), 366 * DAY);
    }

    /// The pilot's longest timelock is REVOKE's day, so a proposal lives at
    /// least two: one more to be signed and executed in. 0 no longer means
    /// forever.
    function test_RevertWhen_ProposalLifetimeLeavesNoTimeAfterTheLongestTimelock() public {
        uint64 shortest = DAY + governance.MIN_SIGNING_WINDOW();
        uint64[3] memory tooShort = [uint64(0), 1, shortest - 1];
        for (uint256 i = 0; i < tooShort.length; i++) {
            vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
            deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), tooShort[i]);
        }
        CertificateGovernance deployed = deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), shortest);
        assertEq(deployed.getTi(TI_ID).proposalTtl, shortest);
    }

    function _expectRefused(IGovernanceTypes.PolicyKind kind, IGovernanceTypes.Policy memory refused) private {
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        deploy(pilotWith(kind, refused));
    }
}

/// CertificateGovernance behind its beacon proxy.
contract ProxyTest is GovernanceTest {
    function test_RevertWhen_TheImplementationIsInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(taoDid, address(registry));
    }

    function test_RevertWhen_TheProxyIsInitializedASecondTime() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        governance.initialize(taoDid, address(registry));
    }

    function test_RecordsTheTaosDidAndTheRegistries() public view {
        assertEq(governance.taoDid(), taoDid);
        assertEq(governance.didRegistry(), didRegistry);
        assertEq(governance.issuersRegistry(), issuersRegistry);
    }

    /// The registries are immutables: the implementation's code carries them,
    /// and the proxy, running that code, answers the same.
    function test_TheRegistriesComeWithTheImplementation() public view {
        assertEq(implementation.didRegistry(), didRegistry);
        assertEq(implementation.issuersRegistry(), issuersRegistry);
    }

    /// A new implementation with other registries is the one way to change
    /// them: every proxy on the beacon follows it, and keeps its storage.
    function test_ANewImplementationCarriesOtherRegistries() public {
        address otherDidRegistry = address(new StubDidRegistry());
        address otherIssuersRegistry = address(new StubIssuersRegistry());
        beacon.upgradeTo(address(new CertificateGovernance(otherDidRegistry, otherIssuersRegistry)));

        assertEq(governance.didRegistry(), otherDidRegistry);
        assertEq(governance.issuersRegistry(), otherIssuersRegistry);
        assertEq(governance.taoDid(), taoDid);
    }

    function test_RevertWhen_NoTaoDid() public {
        _expectInitializationRefused(abi.encodeWithSelector(IGovernanceTypes.InvalidTaoDid.selector), "");
    }

    function test_RevertWhen_TheDidRegistryHasNoCode() public {
        vm.expectRevert(IGovernanceTypes.InvalidRegistry.selector);
        new CertificateGovernance(outsider, issuersRegistry);
    }

    function test_RevertWhen_TheIssuersRegistryHasNoCode() public {
        vm.expectRevert(IGovernanceTypes.InvalidRegistry.selector);
        new CertificateGovernance(didRegistry, outsider);
    }

    function _expectInitializationRefused(bytes memory error, string memory did) private {
        bytes memory init = abi.encodeCall(CertificateGovernance.initialize, (did, address(registry)));
        vm.expectRevert(error);
        new BeaconProxy(address(beacon), init);
    }

    /// The TAO is its DID: there is no owner, so nothing to transfer or
    /// renounce, and no key outside the DID's document acts as the TAO.
    function test_HasNoOwner() public {
        string[3] memory gone = ["owner()", "transferOwnership(address)", "renounceOwnership()"];
        for (uint256 i = 0; i < gone.length; i++) {
            vm.prank(tao);
            (bool ok,) = address(governance).call(abi.encodeWithSignature(gone[i], spare));
            assertFalse(ok, gone[i]);
        }
    }

    function test_RevertWhen_AKeyOutsideTheTaosDidActsAsTheTao() public {
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setCosigners(TI_ID, new IGovernanceTypes.Cosigner[](0));
    }

    /// Audit: a TAO key rotated out of the DID Registry kept the owner's
    /// powers, transferred ownership to itself and locked the TAO's new key
    /// out. The DID is now the TAO: the old key loses every TAO power at once,
    /// and the new key gains them at once, with nothing to transfer.
    function test_ARotatedTaoKeyLosesTheTaosPowersAndItsReplacementGainsThem() public {
        address newKey = makeAddr("tao new key");
        StubDidRegistry(didRegistry).setController(taoDid, tao, false);
        StubDidRegistry(didRegistry).setController(taoDid, newKey, true);
        IGovernanceTypes.Cosigner[] memory none = new IGovernanceTypes.Cosigner[](0);

        vm.startPrank(tao);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setCosigners(TI_ID, none);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.addTi(setup("did:ebsi:zOther", keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilot, pilotTtl));
        vm.stopPrank();

        vm.startPrank(newKey);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.CosignersChanged(TI_ID);
        governance.setCosigners(TI_ID, none);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.TiAttributeChanged(TI_ID, TI_ATTRIBUTE);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE);
        accreditTi("did:ebsi:zOther");
        governance.addTi(setup("did:ebsi:zOther", keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilot, pilotTtl));
        vm.stopPrank();
    }

    /// The DID Registry is asked on every call, so a key it lists again acts
    /// again: nothing in this contract remembers a key's past.
    function test_ATaoKeyListedAgainActsAgain() public {
        StubDidRegistry(didRegistry).setController(taoDid, tao, false);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setCosigners(TI_ID, new IGovernanceTypes.Cosigner[](0));

        StubDidRegistry(didRegistry).setController(taoDid, tao, true);
        vm.prank(tao);
        governance.setCosigners(TI_ID, new IGovernanceTypes.Cosigner[](0));
    }

    function test_TheProxyFollowsTheBeaconsImplementation() public view {
        assertEq(beacon.implementation(), address(implementation));
        assertNotEq(address(governance), address(implementation));
        address[] memory signers = governance.getTi(TI_ID).signers;
        assertEq(signers, keys(A, B, C));
    }

    /// EBSI's Proxy Factory prefers the implementation's own ERC-165-advertised
    /// initializer selector over the template's stored one (ProxyFactory.sol).
    function test_TheImplementationAdvertisesItsInitializerSelectorOverErc165() public view {
        bytes4 initSelectorInterfaceId = 0xf622b441; // getImplementationInitSelector()
        assertTrue(IERC165(address(implementation)).supportsInterface(initSelectorInterfaceId));
        assertEq(
            CertificateGovernance(address(implementation)).getImplementationInitSelector(),
            CertificateGovernance.initialize.selector
        );
    }
}

/// CertificateGovernance (component 10): proposing.
contract ProposingTest is GovernanceTest {
    function test_CountsTheProposersSignatureWithItsRole() public {
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalCreated(1, TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN, A);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalSigned(1, A, ROLE_A, only(ROLE_A));
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);

        IGovernanceTypes.ProposalView memory p = governance.getProposal(1);
        assertEq(uint8(p.state), uint8(IGovernanceTypes.ProposalState.PROPOSED));
        assertEq(p.proposer, A);
        assertEq(p.rolesSignedMask, only(ROLE_A), "roles signed");
    }

    function test_RevertWhen_SuspensionOrRevocationGivesNoReason() public {
        vm.expectRevert(IGovernanceTypes.ReasonRequired.selector);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, NO_REASON);
        vm.expectRevert(IGovernanceTypes.ReasonRequired.selector);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, NO_REASON);
    }

    function test_LetsAReinstatementGoWithoutOne() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, NO_REASON);
        assertEq(governance.getProposal(1).reasonHash, NO_REASON);
    }

    function test_RevertWhen_CallerIsNotASignerOrTheCertificateIsUnknown() public {
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        propose(outsider, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        propose(A, bytes32(0), IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    function test_AllowsOneOpenProposalPerCertificate() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.ProposalAlreadyOpen.selector, 1));
        propose(B, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    function test_ExpiresAStaleProposalInsteadOfBlockingANewOne() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        skip(pilotTtl);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(1, CERTIFICATE);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        assertState(1, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(governance.openProposalFor(CERTIFICATE), 2);
    }
}

/// Quorum and the timelock (component 10.4).
contract QuorumTest is GovernanceTest {
    function test_ASuspensionTakesEffectAtQuorum() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectEmit(address(governance));
        emit IStatusProposals.QuorumReached(1, uint64(block.timestamp));
        sign(1, B);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);

        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExecuted(1, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND);
        execute(1, A);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
    }

    function test_ARevocationWaitsOutItsTimelock() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, C);
        IGovernanceTypes.ProposalView memory p = governance.getProposal(1);
        assertEq(uint8(p.state), uint8(IGovernanceTypes.ProposalState.APPROVED));
        assertEq(p.executableAt, p.quorumReachedAt + DAY);

        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, p.executableAt));
        execute(1, B);
        vm.warp(p.executableAt);
        execute(1, B);
        assertState(1, IGovernanceTypes.ProposalState.EXECUTED);
    }

    function test_RevertWhen_ExecutedBeforeQuorumOrSignedTwiceByOneKey() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(1, A);
        vm.expectRevert(IGovernanceTypes.AlreadySigned.selector);
        sign(1, A);
    }

    function test_CountsRolesNotKeys() public {
        // Two keys of one organisation are one voice.
        governance = deploy(keys(A, spare, C), roles(ROLE_A, ROLE_A, ROLE_C), pilotPolicies(), pilotTtl);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, spare);
        assertState(1, IGovernanceTypes.ProposalState.PROPOSED);
        sign(1, C);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_StopsCountingASignatureOnceItsKeyIsRemoved() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, B);
        applyAdmin(removeSigner(A, C, B));
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(1, A);
        sign(1, C);
        execute(1, A);
    }
}

/// The veto (component 10.4).
contract VetoTest is GovernanceTest {
    function test_AnyOneSignerStopsAProposalEvenDuringTheTimelock() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalCancelled(1, CERTIFICATE, C, REASON);
        cancel(1, C, REASON);

        skip(DAY);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        execute(1, A);
        // The certificate can be proposed again.
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
    }

    function test_NamesTheCertificateInTheEventAndTakesNoReasonAtAll() public {
        // Whoever follows a certificate's history sees the veto without reading
        // the proposal (its key is an indexed topic); the reason itself stays
        // off chain (component 10.3).
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalCancelled(1, CERTIFICATE, B, bytes32(0));
        cancel(1, B, bytes32(0));
    }

    function test_RevertWhen_TheCallerIsNotASigner() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        cancel(1, outsider, REASON);
    }
}

/// The veto, when the policy gives it to the supervisory authority alone.
contract SupervisorVetoTest is GovernanceTest {
    function setUp() public override {
        super.setUp();
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, only(ROLE_C), DAY)));
    }

    function test_TheSupervisoryAuthorityVetoes() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        cancel(1, C, REASON);
        assertState(1, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function test_RevertWhen_AnotherRolesKeyVetoes() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        cancel(1, B, REASON);
    }

    function test_TheProposerStillWithdrawsItsOwnProposal() public {
        // How the back-office closes the on-chain side of a case it rejected.
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        cancel(1, A, REASON);
        assertState(1, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function test_OtherKindsKeepTheirOwnVetoRoles() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        cancel(1, B, REASON);
        assertState(1, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function test_RevertWhen_TheVetosLastKeyIsRemoved() public {
        vm.expectRevert(IGovernanceTypes.Unsatisfiable.selector);
        vm.prank(A);
        governance.proposeRemoveSigner(TI_ID, C);
    }
}

/// Expiry.
contract ExpiryTest is GovernanceTest {
    function test_AProposalPastItsLifetimeCanNoLongerBeSigned() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        skip(pilotTtl);
        assertState(1, IGovernanceTypes.ProposalState.EXPIRED);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        sign(1, B);
    }

    function test_AnyoneMayRecordTheExpiryButNotBeforeItsTime() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        vm.prank(outsider);
        governance.expireProposal(1);

        skip(pilotTtl);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(1, CERTIFICATE);
        vm.prank(outsider);
        governance.expireProposal(1);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
    }

    function test_RevertWhen_TheProposalToExpireIsUnknownOrClosed() public {
        vm.expectRevert(IGovernanceTypes.UnknownProposal.selector);
        governance.expireProposal(99);

        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, B);
        execute(1, A);
        skip(pilotTtl);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.expireProposal(1);
    }

    function test_AnyoneMayRecordARuleChangesExpiryButNotBeforeItsTime() public {
        vm.prank(A);
        uint256 id = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        vm.prank(outsider);
        governance.expireAdminProposal(id);

        skip(pilotTtl);
        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminProposalExpired(id);
        vm.prank(outsider);
        governance.expireAdminProposal(id);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// Found by the invariant tests: the lifetime was read from the TI's
    /// current TTL, so lengthening it revived a proposal nobody had marked
    /// expired, and an old REVOKE could still be signed and executed.
    function test_ATtlChangeDoesNotReviveAnExpiredProposal() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        skip(pilotTtl);
        setTtl(A, B, governance.MAX_PROPOSAL_TTL());
        assertState(1, IGovernanceTypes.ProposalState.EXPIRED);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        sign(1, B);
    }

    function test_ATtlChangeDoesNotReviveAnExpiredRuleChange() public {
        vm.prank(A);
        uint256 id = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        skip(pilotTtl);
        setTtl(A, B, governance.MAX_PROPOSAL_TTL());
        assertAdminState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        signAdmin(id, B);
    }

    /// The lifetime is the one set when the proposal opened, either way.
    function test_ATtlChangeDoesNotShortenAnOpenProposal() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        setTtl(A, B, 7 * DAY);
        skip(8 * DAY);
        assertState(1, IGovernanceTypes.ProposalState.PROPOSED);
        sign(1, B);
    }
}

/// A quorum lost and regained (component 10.4).
contract QuorumRegainedTest is GovernanceTest {
    function test_RestartsTheTimelockWhenAReplacedKeysSuccessorSigns() public {
        // The review's scenario: B's key is rotated an hour before the end of
        // the timelock, and the new B key signs half an hour later. A rotation
        // waits as long as a revocation, so it was proposed an hour before it.
        uint256 rotation = replaceSigner(A, C, B, spare);
        skip(HOUR);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        applyAdmin(rotation);
        assertEq(block.timestamp, first.quorumReachedAt + DAY - HOUR);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(1, A);

        vm.warp(first.quorumReachedAt + DAY - HOUR / 2);
        vm.expectEmit(address(governance));
        emit IStatusProposals.QuorumReached(1, uint64(block.timestamp) + DAY);
        sign(1, spare);
        IGovernanceTypes.ProposalView memory again = governance.getProposal(1);
        assertEq(uint8(again.state), uint8(IGovernanceTypes.ProposalState.APPROVED));
        assertEq(again.executableAt, again.quorumReachedAt + DAY);
        assertGt(again.quorumReachedAt, first.quorumReachedAt + DAY - HOUR);

        // Past the original end, still locked: the new approval gets the full delay.
        vm.warp(first.executableAt + 1);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, again.executableAt));
        execute(1, A);
        vm.warp(again.executableAt);
        execute(1, A);
    }

    function test_RestartsItWhenARemovedKeysSignatureIsMadeUpByAnotherRole() public {
        uint256 removal = removeSigner(A, C, B);
        skip(HOUR);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        applyAdmin(removal);
        sign(1, C);
        IGovernanceTypes.ProposalView memory again = governance.getProposal(1);
        assertGt(again.quorumReachedAt, first.quorumReachedAt);

        vm.warp(first.executableAt);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, again.executableAt));
        execute(1, A);
    }

    function test_RestartsItWhenAStricterPolicyIsMetLateInTheTimelock() public {
        uint256 stricter = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY));
        skip(HOUR);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        applyAdmin(stricter);
        vm.warp(first.executableAt - 60);
        sign(1, C);
        IGovernanceTypes.ProposalView memory again = governance.getProposal(1);
        assertEq(again.executableAt, again.quorumReachedAt + DAY);

        vm.warp(first.executableAt);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, again.executableAt));
        execute(1, A);
        vm.warp(again.executableAt);
        execute(1, A);
    }

    function test_LeavesTheTimelockAloneWhenASignatureDoesNotChangeTheQuorum() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        skip(HOUR);

        vm.recordLogs();
        sign(1, C);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertNotEq(logs[i].topics[0], IStatusProposals.QuorumReached.selector, "no QuorumReached");
        }
        IGovernanceTypes.ProposalView memory now_ = governance.getProposal(1);
        assertEq(uint8(now_.state), uint8(first.state));
        assertEq(now_.quorumReachedAt, first.quorumReachedAt);
        assertEq(now_.executableAt, first.executableAt);
    }

    function test_RestartsARuleChangesTimelockInTheSameWay() public {
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY)));
        uint256 change = setTtl(A, B, 7 * DAY);
        uint256 removal = removeSigner(A, C, B);
        // The removal reached its quorum last, so it is the one to wait for.
        vm.warp(governance.getAdminProposal(removal).executableAt);
        executeAdmin(removal, A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        executeAdmin(change, A);

        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminQuorumReached(change, uint64(block.timestamp) + DAY);
        signAdmin(change, C);
        IGovernanceTypes.AdminProposalView memory again = governance.getAdminProposal(change);
        assertEq(again.executableAt, again.quorumReachedAt + DAY);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, again.executableAt));
        executeAdmin(change, A);
        vm.warp(again.executableAt);
        executeAdmin(change, A);
        assertEq(governance.getTi(TI_ID).proposalTtl, 7 * DAY);
    }
}

/// A removed key is retired.
contract RetiredKeyTest is GovernanceTest {
    function test_CannotBeAddedAgainSoItsOldSignaturesCannotCountAgain() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        applyAdmin(removeSigner(A, C, B));
        assertTrue(governance.retired(TI_ID, B));
        vm.expectRevert(IGovernanceTypes.SignerRetired.selector);
        vm.prank(A);
        governance.proposeAddSigner(TI_ID, B, ROLE_B);
        assertEq(governance.getProposal(1).rolesSignedMask, only(ROLE_A), "roles signed");
    }

    function test_CannotComeBackAsAReplacementEither() public {
        applyAdmin(replaceSigner(A, C, B, spare));
        assertTrue(governance.retired(TI_ID, B));
        assertFalse(governance.retired(TI_ID, spare));
        vm.expectRevert(IGovernanceTypes.SignerRetired.selector);
        vm.prank(A);
        governance.proposeReplaceSigner(TI_ID, spare, B);
    }

    function test_IsCheckedAgainWhenAWaitingChangeApplies() public {
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY)));
        uint256 addBack = addSigner(A, B, spare, ROLE_A);
        uint256 rotate = replaceSigner(B, C, C, spare);
        skip(DAY);
        executeAdmin(rotate, A);
        // spare is now C's key, so adding it as A is refused as a duplicate;
        // the point is that the check runs at execution, not only at proposal.
        vm.expectRevert(IGovernanceTypes.DuplicateSigner.selector);
        executeAdmin(addBack, A);
    }
}

/// The supervisory authority on revocations (component 10.2's alternative).
contract SupervisorOnRevocationsTest is GovernanceTest {
    function setUp() public override {
        super.setUp();
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY)));
    }

    function test_TheBodysTwoRolesAloneDoNotRevoke() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        assertState(1, IGovernanceTypes.ProposalState.PROPOSED);
        sign(1, C);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_SuspensionStaysWithTheBodysTwoRoles() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, B);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_RevertWhen_TheSupervisoryAuthoritysLastKeyIsRemoved() public {
        vm.expectRevert(IGovernanceTypes.Unsatisfiable.selector);
        vm.prank(A);
        governance.proposeRemoveSigner(TI_ID, C);
    }
}

/// Self-administration (component 10.4).
contract SelfAdministrationTest is GovernanceTest {
    function test_AddsABackupKeyToARoleThroughTheQuorum() public {
        uint256 id = addSigner(A, B, spare, ROLE_B);
        applyAdmin(id);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, spare)), Role.unwrap(ROLE_B));
        assertEq(governance.getTi(TI_ID).version, 1);
    }

    function test_RotatesAKeyInOneStepKeepingItsRole() public {
        applyAdmin(replaceSigner(A, C, B, spare));
        assertFalse(governance.isSigner(TI_ID, B));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, spare)), Role.unwrap(ROLE_B));
        Role[] memory signerRoles = governance.getTi(TI_ID).roles;
        RoleSet held;
        for (uint256 i = 0; i < signerRoles.length; i++) {
            held = held.with(signerRoles[i]);
        }
        assertEq(signerRoles.length, 3);
        assertEq(held, ALL, "one key per role");
    }

    function test_ChangesAPolicy() public {
        // The supervisory authority required on revocations.
        applyAdmin(setPolicy(C, A, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY)));
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        assertState(1, IGovernanceTypes.ProposalState.PROPOSED);
    }

    function test_RevertWhen_NoQuorumCouldMeetTheChange() public {
        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE, 4, NONE, ALL, DAY);
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.REVOKE, 2, NONE, NONE, DAY);
        vm.expectRevert(IGovernanceTypes.DuplicateSigner.selector);
        governance.proposeAddSigner(TI_ID, B, ROLE_A);
        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        governance.proposeRemoveSigner(TI_ID, outsider);
        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        governance.proposeReplaceSigner(TI_ID, outsider, spare);
        vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        governance.proposeProposalTtl(TI_ID, 400 * DAY);
        vm.stopPrank();
    }

    function test_ChangesHowLongProposalsStayOpen() public {
        applyAdmin(setTtl(A, B, 7 * DAY));
        assertEq(governance.getTi(TI_ID).proposalTtl, 7 * DAY);
    }

    function test_RevertWhen_TheLifetimeWouldEndBeforeATimelockAndTheWindow() public {
        uint64 shortest = DAY + governance.MIN_SIGNING_WINDOW(); // REVOKE's day, then the window
        vm.startPrank(A);
        vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        governance.proposeProposalTtl(TI_ID, 0);
        vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        governance.proposeProposalTtl(TI_ID, shortest - 1);
        vm.stopPrank();
        applyAdmin(setTtl(A, B, shortest));
        assertEq(governance.getTi(TI_ID).proposalTtl, shortest);
    }

    /// ADMIN's timelock is the longest (it covers every status policy's), so
    /// it is the one the lifetime bounds first.
    function test_RevertWhen_ATimelockWouldLeaveNoTimeWithinTheLifetime() public {
        uint64 longest = pilotTtl - governance.MIN_SIGNING_WINDOW();
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        vm.prank(A);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN, 2, NONE, ALL, longest + 1);
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, longest)));
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.ADMIN).timelock, longest);
    }

    function test_RevertWhen_TheCallerIsNotASigner() public {
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        vm.prank(outsider);
        governance.proposeAddSigner(TI_ID, outsider, ROLE_A);
    }
}

/// Self-administration with a timelock on rule changes.
contract SelfAdministrationTimelockTest is GovernanceTest {
    function setUp() public override {
        super.setUp();
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, DAY)));
    }

    /// Each change fits the rules it was proposed under, but not the two
    /// together: the second is checked again when it would apply.
    function test_RevertWhen_TwoApprovedChangesTogetherLeaveATimelockNoTime() public {
        uint256 shorter = setTtl(A, B, 10 * DAY);
        uint256 slower = setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, 20 * DAY));
        vm.warp(governance.getAdminProposal(slower).executableAt);
        executeAdmin(shorter, A);
        assertEq(governance.getTi(TI_ID).proposalTtl, 10 * DAY);
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        executeAdmin(slower, A);
    }

    function test_WaitsOutTheDelayThenAppliesOnRequest() public {
        uint256 id = addSigner(A, B, spare, ROLE_A);
        assertAdminState(id, IGovernanceTypes.ProposalState.APPROVED);
        assertFalse(governance.isSigner(TI_ID, spare));
        vm.expectRevert(
            abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, governance.getAdminProposal(id).executableAt)
        );
        executeAdmin(id, A);

        skip(DAY);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.SignerAdded(TI_ID, spare, ROLE_A);
        executeAdmin(id, C);
    }

    function test_AnySignerVetoesItDuringTheDelay() public {
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, HOUR));
        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminProposalCancelled(id, C);
        cancelAdmin(id, C);
        skip(DAY);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        executeAdmin(id, A);
    }

    function test_OnlyByTheRolesTheRuleChangePolicyGivesTheVeto() public {
        // ADMIN's veto roles cover every status policy's, so all are narrowed.
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].vetoRoleMask = only(ROLE_C);
        }
        governance = deploy(policies);
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, only(ROLE_C), HOUR));
        vm.expectRevert(IGovernanceTypes.VetoNotAllowed.selector);
        cancelAdmin(id, B);
        // Its proposer may withdraw it.
        cancelAdmin(id, A);
        assertAdminState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function test_RevertWhen_TheKeyTheChangeRemovesBlocksItsOwnRemoval() public {
        uint256 id = removeSigner(A, C, B);
        vm.expectRevert(IGovernanceTypes.CannotVetoOwnRemoval.selector);
        cancelAdmin(id, B);
        skip(DAY);
        executeAdmin(id, A);
        assertFalse(governance.isSigner(TI_ID, B));
    }

    function test_ChecksTheChangeAgainWhenItApplies() public {
        uint256 first = addSigner(A, B, spare, ROLE_A);
        uint256 second = addSigner(B, C, spare, ROLE_B);
        skip(DAY);
        executeAdmin(second, A);
        vm.expectRevert(IGovernanceTypes.DuplicateSigner.selector);
        executeAdmin(first, A);
    }
}

/// Audit verification (component 10.7).
contract AuditTest is GovernanceTest {
    string internal constant ISSUER = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    bytes32 internal constant SALT = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
    bytes32 internal constant OTHER_SALT = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

    function test_AnAuditorFindsTheCertificateFromItsTiAndItsId() public {
        // The key is the contract's own, so no salt has to be disclosed.
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        bytes32 proposed = governance.getProposal(1).statusKey;
        assertEq(registry.computeStatusKey(ISSUER, "urn:uuid:fixture"), proposed);
        assertNotEq(registry.computeStatusKey(ISSUER, "urn:uuid:other-fixture"), proposed);
        assertNotEq(registry.computeStatusKey("did:ebsi:zOther", "urn:uuid:fixture"), proposed);
    }

    function test_ACertificatesWholeHistoryIsOneKey() public {
        // Its suspension and revocation cannot be open at once.
        vm.recordLogs();
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.ProposalAlreadyOpen.selector, 1));
        propose(B, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);

        // And its whole history is one value to follow.
        sign(1, B);
        execute(1, A);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint8[] memory created = new uint8[](logs.length);
        uint256 n;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == IStatusProposals.ProposalCreated.selector && logs[i].topics[2] == CERTIFICATE) {
                (, IGovernanceTypes.ActionType action,) = abi.decode(logs[i].data, (bytes32, IGovernanceTypes.ActionType, bytes32));
                created[n++] = uint8(action);
            }
        }
        assertEq(n, 2);
        assertEq(created[0], uint8(IGovernanceTypes.ActionType.SUSPEND));
        assertEq(created[1], uint8(IGovernanceTypes.ActionType.REVOKE));
    }

    function test_TheSignatureHistoryWithItsRolesIsPubliclyReadable() public {
        // Component 10.2: the supervisory authority can check, without access
        // to the certification body's systems, that nothing executed on fewer
        // than two roles.
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory p = governance.getProposal(1);
        assertEq(p.signatures, keys(A, B));
        assertEq(p.rolesSignedMask, both(ROLE_A, ROLE_B), "roles signed");
        assertGt(p.quorumReachedAt, 0);
    }

    function test_CountsProposalsAndTellsWhoSigned() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        assertEq(governance.proposalCount(), 1);
        assertEq(governance.signatureCount(1), 2);
        assertTrue(governance.hasSigned(1, B));
        assertFalse(governance.hasSigned(1, C));

        vm.prank(A);
        uint256 change = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        assertTrue(governance.hasSignedAdmin(change, A));
        assertFalse(governance.hasSignedAdmin(change, B));
    }
}

/// The trust chain above a TI, walked in the Trusted Issuers Registry.
contract TrustChainTest is GovernanceTest {
    function test_ATiWhoseTaosAccreditationIsMissingIsNotActive() public {
        string memory orphan = "did:ebsi:zOrphan";
        issuers.accredit(orphan, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, keccak256("missing"));
        assertFalse(governance.isActiveTi(orphan, TI_ATTRIBUTE));
    }

    function test_AChainThatNeverReachesARootTaoIsNotActive() public {
        string memory looped = "did:ebsi:zLooped";
        bytes32 loop = keccak256("loop");
        issuers.accredit(taoDid, loop, IEbsiIssuersRegistry.IssuerType.TAO, taoDid, loop);
        issuers.accredit(looped, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, loop);
        // It gives up after MAX_TRUST_CHAIN_DEPTH hops, not before.
        vm.expectCall(
            issuersRegistry,
            abi.encodeCall(IEbsiIssuersRegistry.getLatestRevisionAttribute, (taoDid, loop)),
            governance.MAX_TRUST_CHAIN_DEPTH()
        );
        assertFalse(governance.isActiveTi(looped, TI_ATTRIBUTE));
    }
}

/// Audit verification of the reason.
contract ReasonTest is GovernanceTest {
    bytes32 internal constant REASON_SALT = 0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a;
    bytes32 internal constant OTHER_SALT = 0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b;

    function test_ComputeReasonHashIsSha256OverCategoryNoteAndSalt() public view {
        // Computed with ethers' ABI coder:
        // sha256(abi.encode("PLR-REASON-V1", code, note, REASON_SALT)).
        assertEq(
            governance.computeReasonHash("conditions_not_met", "", REASON_SALT),
            0xbeeb5c3fae61b7c6c16f9858d0f0cc62bea4bb5f654888e1a55d4a3fecbbd37e
        );
        assertEq(
            governance.computeReasonHash("other", unicode"Poznámka s diakritikou", REASON_SALT),
            0x7e015ec16b78e60a0306e7feef726f42cadf79aff30a4c21e88e295fc5d9edf3
        );
    }

    function test_GoesOnChainWithTheProposalAndAnAuditorConfirmsIt() public {
        string memory note = unicode"rozhodnutie č. 12/2026";
        bytes32 committed = 0xc3be25c697da45120354cec9c90a040a52b0079b42ea42efabbb8891cefdc198;
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalCreated(1, TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, committed, A);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, committed);

        assertEq(governance.getProposal(1).reasonHash, committed);
        assertTrue(governance.verifyProposalReason(1, "supervisory_decision", note, REASON_SALT));
        assertFalse(governance.verifyProposalReason(1, "conditions_not_met", note, REASON_SALT));
        assertFalse(governance.verifyProposalReason(1, "supervisory_decision", "", REASON_SALT));
        assertFalse(governance.verifyProposalReason(1, "supervisory_decision", note, OTHER_SALT));
    }

    function test_HidesTheCategory() public view {
        // The same reason under another salt is another hash.
        assertNotEq(
            governance.computeReasonHash("holder_request", "", REASON_SALT),
            governance.computeReasonHash("holder_request", "", OTHER_SALT)
        );
    }

    function test_AReinstatementThatGaveNoneVerifiesAgainstNothing() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, NO_REASON);
        assertFalse(governance.verifyProposalReason(1, "", "", bytes32(0)));
    }
}

/// Privacy (components 10.3, 10.8). Which fields a proposal has is checked
/// on the ABI, in test/abi.test.mjs.
contract PrivacyTest is GovernanceTest {
    function test_TwoCertificatesShowNothingInCommon() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        assertNotEq(governance.getProposal(1).statusKey, governance.getProposal(2).statusKey);
    }
}

/// Unknown proposals.
contract UnknownProposalTest is GovernanceTest {
    function test_RevertWhen_TheProposalOrRuleChangeDoesNotExist() public {
        vm.expectRevert(IGovernanceTypes.UnknownProposal.selector);
        governance.getProposal(99);
        vm.expectRevert(IGovernanceTypes.UnknownProposal.selector);
        governance.getAdminProposal(99);
        vm.expectRevert(IGovernanceTypes.UnknownProposal.selector);
        sign(99, A);
        vm.expectRevert(IGovernanceTypes.UnknownProposal.selector);
        signAdmin(99, A);
    }
}
