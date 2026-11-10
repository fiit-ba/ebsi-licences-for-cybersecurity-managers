// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {CertificateGovernance} from "../../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../../contracts/CertificateRegistry.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {IStatusProposals} from "../../contracts/interfaces/IStatusProposals.sol";
import {Networks} from "../../scripts/Networks.sol";
import {DidRegistry} from "ebsi-mock/did-registry/DidRegistry.sol";
import {IssuersRegistry} from "ebsi-mock/issuers-registry/IssuersRegistry.sol";
import {IIssuersRegistry as TIR} from "ebsi-mock/issuers-registry/interfaces/IIssuersRegistry.sol";
import {VersionedUpgradeableBeacon} from "ebsi-mock/beacon-proxy/VersionedUpgradeableBeacon.sol";

/**
 * Integration tests: the contracts as the deployment scripts put them on a
 * chain, with EBSI's own registries, not as a test fixture builds them.
 *
 * scripts/integration-test.sh starts anvil, deploys the EBSI contracts
 * (DeployEBSI.s.sol), both contracts through EBSI's Proxy Factory
 * (Deploy.s.sol), seeds the DIDs and accreditations (SeedEbsi.s.sol), sets
 * the TI up (AddTi.s.sol), and then runs these against a fork of that chain,
 * reading the addresses from deployments/anvil*.json. Each test starts from
 * that state. Without PLR_INTEGRATION=true they are skipped, so a plain
 * `forge test` runs without a chain.
 *
 * Who is who: the development keys scripts/Networks.sol names, as
 * SeedEbsi.s.sol and AddTi.s.sol set them up.
 */
abstract contract DeployedFixture is Test, Networks {
    string internal constant ROOT = "did:ebsi:zDevelopmentRoot";
    string internal constant TAO = "did:ebsi:zDevelopmentTao";
    string internal constant TI = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    string internal constant NBU = "did:ebsi:zDevelopmentNbu";
    bytes32 internal constant SALT = keccak256("development");
    bytes32 internal constant REASON = keccak256("reason");

    CertificateGovernance internal governance;
    CertificateRegistry internal registry;
    DidRegistry internal didr;
    IssuersRegistry internal tir;
    VersionedUpgradeableBeacon internal beacon;

    address internal tao;
    address internal keyA;
    address internal keyB;
    address internal nbu;
    address internal root;
    address internal deployer;
    bytes32 internal tiId;
    bytes32 internal tiAttribute;
    bytes32 internal taoAttribute;
    bytes32 internal rootAttribute;

    uint256 private certificates;

    function setUp() public virtual {
        if (!vm.envOr("PLR_INTEGRATION", false)) {
            vm.skip(true);
            return;
        }
        string memory dir = string.concat(vm.projectRoot(), "/deployments/");
        string memory record = vm.readFile(string.concat(dir, "anvil.json"));
        string memory ebsi = vm.readFile(string.concat(dir, "anvil-ebsi.json"));
        governance = CertificateGovernance(vm.parseJsonAddress(record, ".CertificateGovernance.address"));
        registry = CertificateRegistry(vm.parseJsonAddress(record, ".CertificateRegistry.address"));
        beacon = VersionedUpgradeableBeacon(vm.parseJsonAddress(record, ".CertificateGovernance.beacon"));
        didr = DidRegistry(vm.parseJsonAddress(ebsi, ".ebsi.DidRegistry.contractAddress"));
        tir = IssuersRegistry(vm.parseJsonAddress(ebsi, ".ebsi.IssuersRegistry.contractAddress"));

        (tao, keyA, keyB, nbu, root) =
        (
            _developmentAccount(DEVELOPMENT_TAO),
            _developmentAccount(DEVELOPMENT_SIGNER_A),
            _developmentAccount(DEVELOPMENT_SIGNER_B),
            _developmentAccount(DEVELOPMENT_NBU),
            _developmentAccount(DEVELOPMENT_ROOT_TAO)
        );
        deployer = _developmentAccount(DEVELOPMENT_DEPLOYER);
        tiId = governance.computeTiId(TI);
        tiAttribute = _attributeId(TI);
        taoAttribute = _attributeId(TAO);
        rootAttribute = _attributeId(ROOT);
    }

    /// The id SeedEbsi.s.sol's first accreditation of `did` got.
    function _attributeId(string memory did) internal pure returns (bytes32) {
        return sha256(abi.encode(did, SALT, uint256(0), bytes("")));
    }

    /// A new certificate of the TI on record, as the back-office records a
    /// collected one; returns its status key.
    function _register() internal returns (bytes32 statusKey, string memory id) {
        id = string.concat("urn:uuid:integration-", vm.toString(++certificates));
        bytes32 idHash = Hashes.certificateIdHash(id);
        bytes32 credentialHash = sha256(bytes(id));
        vm.prank(keyA);
        statusKey = registry.registerCertificate(
            idHash,
            TI,
            uint64(block.timestamp),
            uint64(block.timestamp + 365 days),
            credentialHash,
            IGovernanceTypes.Standing.VALID
        );
    }

    function _propose(address by, bytes32 statusKey, IGovernanceTypes.ActionType action) internal returns (uint256 id) {
        vm.prank(by);
        id = governance.proposeAction(tiId, statusKey, action, REASON);
    }

    function _sign(address by, uint256 id) internal {
        vm.prank(by);
        governance.signProposal(id);
    }

    function _execute(address by, uint256 id) internal {
        vm.prank(by);
        governance.execute(id);
    }

    /// A revocation of a new certificate, approved by keys A and B and
    /// waiting out its timelock.
    function _approvedRevocation() internal returns (bytes32 statusKey, uint256 id) {
        (statusKey,) = _register();
        id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.REVOKE);
        _sign(keyB, id);
        assertEq(uint8(governance.stateOf(id)), uint8(IGovernanceTypes.ProposalState.APPROVED));
    }

    /// `by` signs a rule change.
    function _signAdmin(address by, uint256 change) internal {
        vm.prank(by);
        governance.signAdminProposal(change);
    }

    /// A new key of the TI's DID in the DID Registry, added by its key A:
    /// development key `index`, as `<TI>#<suffix>`.
    function _addTiKey(uint256 index, string memory suffix) internal returns (address key) {
        key = _developmentAccount(index);
        string memory method = string.concat(TI, "#", suffix);
        Vm.Wallet memory wallet = vm.createWallet(_developmentKey(index));
        bytes memory publicKey = abi.encodePacked(bytes1(0x04), wallet.publicKeyX, wallet.publicKeyY);
        vm.startPrank(keyA);
        didr.addVerificationMethod(TI, method, publicKey, true);
        didr.addVerificationRelationship(TI, "capabilityInvocation", method, block.timestamp, block.timestamp + 365 days);
        vm.stopPrank();
    }

    function _standing(bytes32 statusKey) internal view returns (IGovernanceTypes.Standing) {
        return registry.certificateStatus(statusKey).standing;
    }

    function _assertStanding(bytes32 statusKey, IGovernanceTypes.Standing expected) internal view {
        assertEq(uint8(_standing(statusKey)), uint8(expected), "standing");
    }
}

/// What the deployment scripts left on the chain.
contract DeploymentTest is DeployedFixture {
    function test_BothContractsAreWiredToEachOtherAndToEbsisRegistries() public view {
        assertEq(registry.governance(), address(governance));
        assertEq(governance.certificateRegistry(), address(registry));
        assertEq(governance.didRegistry(), address(didr));
        assertEq(governance.issuersRegistry(), address(tir));
        assertEq(governance.taoDid(), TAO);
        assertEq(governance.owner(), tao);
        assertEq(registry.owner(), tao);
    }

    function test_TheTiIsSetUpWithItsKeysAndNbuAsItsCosigner() public view {
        assertTrue(governance.isActiveTi(TI, tiAttribute));
        IGovernanceTypes.TiView memory ti = governance.getTi(tiId);
        assertEq(ti.did, TI);
        assertEq(ti.signers.length, 2);
        assertEq(Role.unwrap(governance.roleOf(tiId, keyA)), 1);
        assertEq(Role.unwrap(governance.roleOf(tiId, keyB)), 2);
        assertEq(ti.cosigners.length, 1);
        assertEq(ti.cosigners[0].did, NBU);
        assertEq(Role.unwrap(governance.roleOf(tiId, nbu)), 3, "NBU's key signs through its DID");
        assertEq(Role.unwrap(governance.roleOf(tiId, root)), 0);
    }

    function test_TheProxyRunsTheBeaconsVersion() public view {
        assertEq(beacon.proxyVersionOf(address(governance)), 1);
        assertEq(beacon.proxyOwnerOf(address(governance)), deployer);
    }
}

/// A certificate's life on chain (components 10.5, 10.6).
contract CertificateLifecycleTest is DeployedFixture {
    function test_ARegisteredCertificateIsWhatAVerifierReads() public {
        (bytes32 statusKey, string memory id) = _register();
        assertEq(registry.computeStatusKey(TI, id), statusKey, "the verifier's key");
        IGovernanceTypes.Certificate memory certificate = registry.certificateStatus(statusKey);
        assertEq(uint8(certificate.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(certificate.issuerDid, TI);
        assertEq(certificate.credentialHash, sha256(bytes(id)));
    }

    function test_AQuorumSuspendsAndAnotherReinstatesWithTheCosigner() public {
        (bytes32 statusKey,) = _register();
        uint256 suspension = _propose(keyA, statusKey, IGovernanceTypes.ActionType.SUSPEND);
        _sign(keyB, suspension);
        _execute(keyA, suspension);
        _assertStanding(statusKey, IGovernanceTypes.Standing.SUSPENDED);

        uint256 reinstatement = _propose(keyA, statusKey, IGovernanceTypes.ActionType.REINSTATE);
        _sign(nbu, reinstatement);
        _execute(keyA, reinstatement);
        _assertStanding(statusKey, IGovernanceTypes.Standing.VALID);
    }

    function test_ARevocationWaitsOutItsTimelockAndIsFinal() public {
        (bytes32 statusKey,) = _register();
        uint256 id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.REVOKE);
        _sign(keyB, id);
        uint64 executableAt = governance.getProposal(id).executableAt;
        assertGt(executableAt, block.timestamp, "pilot.json gives a revocation a timelock");

        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        _execute(keyA, id);

        vm.warp(executableAt);
        _execute(keyA, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.REVOKED);

        vm.prank(keyA);
        vm.expectRevert(IGovernanceTypes.CertificateRevoked.selector);
        governance.proposeAction(tiId, statusKey, IGovernanceTypes.ActionType.REINSTATE, bytes32(0));
        vm.prank(keyA);
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        registry.suspendNow(statusKey, REASON);
    }

    function test_TheCosignerVetoesARevocationDuringItsTimelock() public {
        (bytes32 statusKey,) = _register();
        uint256 id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.REVOKE);
        _sign(keyB, id);
        vm.prank(nbu);
        governance.cancelProposal(id, REASON);
        assertEq(uint8(governance.stateOf(id)), uint8(IGovernanceTypes.ProposalState.CANCELLED));
        _assertStanding(statusKey, IGovernanceTypes.Standing.VALID);
    }

    function test_OneSignerSuspendsAtOnce() public {
        (bytes32 statusKey,) = _register();
        vm.prank(keyB);
        registry.suspendNow(statusKey, REASON);
        _assertStanding(statusKey, IGovernanceTypes.Standing.SUSPENDED);
    }

    function test_RevertWhen_AnOutsiderActs() public {
        (bytes32 statusKey,) = _register();
        vm.prank(root);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        registry.suspendNow(statusKey, REASON);
    }
}

/// The trust chain, changed in EBSI's registries rather than in the contract.
contract TrustChainTest is DeployedFixture {
    function test_ATiTheTaoRevokesStopsButStillSuspendsItsCertificates() public {
        (bytes32 statusKey,) = _register();
        vm.prank(tao);
        tir.setAttributeMetadata(TI, tiAttribute, TIR.IssuerType.Revoked, TAO, taoAttribute);
        assertFalse(governance.isActiveTi(TI, tiAttribute));

        vm.prank(keyA);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(tiId, statusKey, IGovernanceTypes.ActionType.SUSPEND, REASON);

        bytes32 idHash = Hashes.certificateIdHash("urn:uuid:after-revocation");
        vm.prank(keyA);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        registry.registerCertificate(idHash, TI, 1, 0, REASON, IGovernanceTypes.Standing.VALID);

        // D43: withdrawing its certificates starts here.
        vm.prank(keyA);
        registry.suspendNow(statusKey, REASON);
        _assertStanding(statusKey, IGovernanceTypes.Standing.SUSPENDED);
    }

    function test_RevokingTheTaoTakesItsTiWithIt() public {
        vm.prank(root);
        tir.setAttributeMetadata(TAO, taoAttribute, TIR.IssuerType.Revoked, ROOT, rootAttribute);
        assertEq(uint8(tir.getLatestRevisionAttribute(TI, tiAttribute).issuerType), uint8(TIR.IssuerType.TI));
        assertFalse(governance.isActiveTi(TI, tiAttribute));
    }

    function test_AKeyTheDidRegistryRevokesNoLongerSigns() public {
        (bytes32 statusKey,) = _register();
        uint256 id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.SUSPEND);
        vm.prank(keyA);
        didr.revokeVerificationMethod(TI, string.concat(TI, "#key-2"), block.timestamp);
        vm.warp(block.timestamp + 1);

        assertEq(Role.unwrap(governance.roleOf(tiId, keyB)), 0);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        _sign(keyB, id);
    }
}

/// The TI's own rule changes, and the code's upgrade.
contract AdministrationTest is DeployedFixture {
    function test_TheTiRotatesAKeyThroughItsQuorum() public {
        address next = _addTiKey(6, "key-3");
        vm.prank(keyA);
        uint256 change = governance.proposeReplaceSigner(tiId, keyB, next);
        _signAdmin(nbu, change);

        assertEq(Role.unwrap(governance.roleOf(tiId, next)), 2, "the new key holds role B");
        assertTrue(governance.retired(tiId, keyB));

        (bytes32 statusKey,) = _register();
        uint256 id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.SUSPEND);
        _sign(next, id);
        _execute(next, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.SUSPENDED);
    }

    function test_AnUpgradeKeepsTheRecordsAndTheTi() public {
        (bytes32 statusKey,) = _register();
        address implementation = address(new CertificateGovernance());
        vm.startPrank(deployer);
        beacon.addVersion(2, implementation, keccak256(implementation.code), false);
        beacon.upgradeProxyToVersion(address(governance), 2, true);
        vm.stopPrank();

        assertEq(beacon.proxyVersionOf(address(governance)), 2);
        assertEq(governance.getTi(tiId).did, TI);
        _assertStanding(statusKey, IGovernanceTypes.Standing.VALID);
        uint256 id = _propose(keyA, statusKey, IGovernanceTypes.ActionType.SUSPEND);
        _sign(keyB, id);
        _execute(keyA, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.SUSPENDED);
    }
}

/// A quorum the TI's own changes take away from an approved proposal, and
/// how it is made up again (component 10.4). The timelock starts over when it
/// is: the veto gets its full time again.
contract QuorumAfterChangesTest is DeployedFixture {
    uint64 internal constant DAY = 1 days;

    function test_ARuleChangeWaitsOutItsTimelockThenApplies() public {
        // The pilot applies rule changes at once; this one gives them a day.
        vm.prank(keyA);
        uint256 slower = governance.proposePolicy(tiId, IGovernanceTypes.PolicyKind.ADMIN, 2, _roles(0), _roles(7), DAY);
        _signAdmin(keyB, slower);
        assertEq(governance.getPolicy(tiId, IGovernanceTypes.PolicyKind.ADMIN).timelock, DAY);

        uint64 ttl = governance.getTi(tiId).proposalTtl;
        vm.prank(keyA);
        uint256 change = governance.proposeProposalTtl(tiId, 7 days);
        _signAdmin(keyB, change);
        uint64 executableAt = governance.getAdminProposal(change).executableAt;
        assertEq(governance.getTi(tiId).proposalTtl, ttl, "not before the timelock");

        vm.prank(keyA);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        governance.executeAdminProposal(change);

        vm.warp(executableAt);
        vm.prank(keyB);
        governance.executeAdminProposal(change);
        assertEq(governance.getTi(tiId).proposalTtl, 7 days);
    }

    function test_AStricterPolicyHoldsAnApprovedRevocationUntilTheCosignerSigns() public {
        (bytes32 statusKey, uint256 id) = _approvedRevocation();

        // Revocations now need NBÚ's role C; A and B alone no longer make the quorum.
        vm.prank(keyA);
        uint256 change = governance.proposePolicy(tiId, IGovernanceTypes.PolicyKind.REVOKE, 2, _roles(4), _roles(7), DAY);
        _signAdmin(keyB, change);

        vm.warp(governance.getProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        _execute(keyA, id);

        _signAndWaitOut(nbu, id);
        _execute(keyA, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.REVOKED);
    }

    function test_ARotatedKeysSignatureStopsCountingAndItsSuccessorMakesItUp() public {
        (bytes32 statusKey, uint256 id) = _approvedRevocation();

        address next = _addTiKey(6, "key-3");
        vm.prank(keyA);
        uint256 change = governance.proposeReplaceSigner(tiId, keyB, next);
        _signAdmin(nbu, change);

        vm.warp(governance.getProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        _execute(keyA, id);
        assertEq(RoleSet.unwrap(governance.getProposal(id).rolesSignedMask), 1, "only A's signature counts");

        // The old key is no signer any more, of this proposal or any other.
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        _sign(keyB, id);

        _signAndWaitOut(next, id);
        _execute(keyA, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.REVOKED);
    }

    function test_AKeyTheTiRemovesAfterApprovalIsMadeUpByAnotherRole() public {
        (bytes32 statusKey, uint256 id) = _approvedRevocation();

        // The TI removes key B; A and NBÚ's C remain, and still meet every policy.
        vm.prank(keyA);
        uint256 change = governance.proposeRemoveSigner(tiId, keyB);
        _signAdmin(nbu, change);
        assertEq(Role.unwrap(governance.roleOf(tiId, keyB)), 0);

        vm.warp(governance.getProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        _execute(keyA, id);

        _signAndWaitOut(nbu, id);
        _execute(keyA, id);
        _assertStanding(statusKey, IGovernanceTypes.Standing.REVOKED);
    }

    /// `by` brings the quorum back: the timelock starts over from now, and
    /// the proposal cannot run before it ends.
    function _signAndWaitOut(address by, uint256 id) private {
        vm.expectEmit(address(governance));
        emit IStatusProposals.QuorumReached(id, uint64(block.timestamp) + DAY);
        _sign(by, id);
        uint64 executableAt = governance.getProposal(id).executableAt;
        assertEq(executableAt, block.timestamp + DAY, "a full timelock again");

        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        _execute(keyA, id);
        vm.warp(executableAt);
    }

    function _roles(uint8 mask) private pure returns (RoleSet) {
        return RoleSet.wrap(mask);
    }
}
