// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
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
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

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

    function _expectRefused(IGovernanceTypes.PolicyKind kind, IGovernanceTypes.Policy memory refused) private {
        vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        deploy(pilotWith(kind, refused));
    }
}

/// CertificateGovernance behind its beacon proxy (DECISIONS.md D45).
contract ProxyTest is GovernanceTest {
    function test_RevertWhen_TheImplementationIsInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(tao, taoDid, didRegistry, issuersRegistry, address(registry));
    }

    function test_RevertWhen_TheProxyIsInitializedASecondTime() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        governance.initialize(outsider, taoDid, didRegistry, issuersRegistry, address(registry));
    }

    function test_TheTaoOwnsTheContractNotItsDeployer() public view {
        assertEq(governance.owner(), tao);
        assertNotEq(governance.owner(), address(this));
    }

    function test_RevertWhen_TheTaoIsTheZeroAddress() public {
        _expectInitializationRefused(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableInvalidOwner.selector, address(0)),
            address(0),
            taoDid,
            issuersRegistry
        );
    }

    function test_RecordsTheTaosDidAndTheRegistries() public view {
        assertEq(governance.taoDid(), taoDid);
        assertEq(governance.didRegistry(), didRegistry);
        assertEq(governance.issuersRegistry(), issuersRegistry);
    }

    function test_RevertWhen_NoTaoDid() public {
        _expectInitializationRefused(abi.encodeWithSelector(IGovernanceTypes.InvalidTaoDid.selector), tao, "", issuersRegistry);
    }

    function test_RevertWhen_ARegistryHasNoCode() public {
        _expectInitializationRefused(abi.encodeWithSelector(IGovernanceTypes.InvalidRegistry.selector), tao, taoDid, outsider);
    }

    function _expectInitializationRefused(bytes memory error, address owner, string memory did, address issuers)
        private
    {
        bytes memory init = abi.encodeCall(
            CertificateGovernance.initialize, (owner, did, didRegistry, issuers, address(registry))
        );
        vm.expectRevert(error);
        new BeaconProxy(address(beacon), init);
    }

    function test_TheTaoAloneTransfersOwnership() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, outsider));
        governance.transferOwnership(outsider);

        vm.prank(tao);
        governance.transferOwnership(spare);
        assertEq(governance.owner(), spare);
    }

    function test_RevertWhen_TheTaoRenouncesTheContract() public {
        vm.expectRevert(IGovernanceTypes.OwnershipNotRenounceable.selector);
        vm.prank(tao);
        governance.renounceOwnership();
        assertEq(governance.owner(), tao);
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
        removeSigner(A, C, B);
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
}

/// A quorum lost and regained (component 10.4).
contract QuorumRegainedTest is GovernanceTest {
    function test_RestartsTheTimelockWhenAReplacedKeysSuccessorSigns() public {
        // The review's scenario: B's key is rotated an hour before the end of
        // the timelock, and the new B key signs half an hour later.
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        vm.warp(first.quorumReachedAt + DAY - HOUR);
        replaceSigner(A, C, B, spare);
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
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        skip(DAY - HOUR);
        removeSigner(A, C, B);
        sign(1, C);
        IGovernanceTypes.ProposalView memory again = governance.getProposal(1);
        assertGt(again.quorumReachedAt, first.quorumReachedAt);

        vm.warp(first.executableAt);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, again.executableAt));
        execute(1, A);
    }

    function test_RestartsItWhenAStricterPolicyIsMetLateInTheTimelock() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(1, B);
        IGovernanceTypes.ProposalView memory first = governance.getProposal(1);
        setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY));
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
        removeSigner(A, C, B);
        assertTrue(governance.retired(TI_ID, B));
        vm.expectRevert(IGovernanceTypes.SignerRetired.selector);
        vm.prank(A);
        governance.proposeAddSigner(TI_ID, B, ROLE_B);
        assertEq(governance.getProposal(1).rolesSignedMask, only(ROLE_A), "roles signed");
    }

    function test_CannotComeBackAsAReplacementEither() public {
        replaceSigner(A, C, B, spare);
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
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, spare)), Role.unwrap(ROLE_B));
        assertEq(governance.getTi(TI_ID).version, 1);
    }

    function test_RotatesAKeyInOneStepKeepingItsRole() public {
        replaceSigner(A, C, B, spare);
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
        setPolicy(C, A, IGovernanceTypes.PolicyKind.REVOKE, policy(2, only(ROLE_C), ALL, DAY));
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
        setTtl(A, B, 7 * DAY);
        assertEq(governance.getTi(TI_ID).proposalTtl, 7 * DAY);
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
        governance = deploy(pilotWith(IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, only(ROLE_C), DAY)));
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, HOUR));
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
        // D42: the key is the contract's own, so no salt has to be disclosed.
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

/// Audit verification of the reason (D22).
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
