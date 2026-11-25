pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {GovernanceTest} from "./GovernanceTest.sol";

/// The boundary between the two contracts: the registry takes its signers
/// and executed proposals from governance, and from no one else.
contract CertificateRegistryTest is GovernanceTest {
    // Computed ahead: sha256 is a call, and would take a pending prank.
    bytes32 internal ID_HASH;

    function setUp() public override {
        super.setUp();
        ID_HASH = Hashes.certificateIdHash("urn:uuid:1");
    }

    function _register() internal returns (bytes32) {
        vm.prank(A);
        return registry.registerCertificate(
            ID_HASH, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID
        );
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length && found; j++) {
                found = haystack[i + j] == needle[j];
            }
            if (found) return true;
        }
        return false;
    }

    function test_TheChainDoesNotHoldTheIdInClear() public {
        vm.recordLogs();
        bytes32 key = _register();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertFalse(_contains(abi.encode(registry.certificateStatus(key)), bytes("urn:uuid:1")));
        for (uint256 i = 0; i < logs.length; i++) {
            assertFalse(_contains(logs[i].data, bytes("urn:uuid:1")));
        }
    }

    function test_AVerifierFindsTheRecordFromTheCertificateAlone() public {
        bytes32 key = _register();
        assertEq(registry.computeStatusKey(TI_DID, "urn:uuid:1"), key);
        assertEq(registry.certificateStatus(key).issuerDid, TI_DID);
    }

    function test_AVerifierComparesTheCredentialItWasShownWithTheRecord() public {
        assertEq(registry.certificateStatus(_register()).credentialHash, CREDENTIAL_HASH);
    }

    /// A registry not yet linked to a governance contract, as the factory
    /// leaves it, owned by the TAO's key.
    function _unlinked() internal returns (CertificateRegistry) {
        return CertificateRegistry(
            address(new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (tao))))
        );
    }

    /// A governance contract initialized with `certificates`.
    function _governanceOf(CertificateRegistry certificates) internal returns (address) {
        bytes memory init = abi.encodeCall(CertificateGovernance.initialize, (taoDid, address(certificates)));
        return address(new BeaconProxy(address(beacon), init));
    }

    function test_RevertWhen_AGovernanceAppliesAProposalToAnUnknownCertificate() public {
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        vm.prank(address(governance));
        registry.applyExecuted(TI_ID, keccak256("no record"), IGovernanceTypes.ActionType.REVOKE, 1, REASON, tao);
    }

    function test_RevertWhen_AGovernanceAppliesAProposalToAnotherTisCertificate() public {
        bytes32 key = _register();
        vm.expectRevert(IGovernanceTypes.NotCertificateIssuer.selector);
        vm.prank(address(governance));
        registry.applyExecuted(keccak256("other"), key, IGovernanceTypes.ActionType.REVOKE, 1, REASON, tao);
    }

    /// Linking was the owner's last act: the registry has no owner left.
    function test_ALinkedRegistryHasNoOwner() public view {
        assertEq(registry.owner(), address(0));
        assertEq(registry.governance(), address(governance));
    }

    function test_RevertWhen_AnyoneElseAppliesAnExecutedProposal() public {
        bytes32 key = _register();
        vm.expectRevert(IGovernanceTypes.NotGovernance.selector);
        vm.prank(tao);
        registry.applyExecuted(
            TI_ID, key, IGovernanceTypes.ActionType.REVOKE, 1, REASON, tao
        );
    }

    function test_TheOwnerLinksGovernanceAndOwnershipEnds() public {
        CertificateRegistry certificates = _unlinked();
        address linked = _governanceOf(certificates);
        vm.expectEmit(address(certificates));
        emit ICertificateRegistry.GovernanceChanged(linked);
        vm.expectEmit(address(certificates));
        emit OwnableUpgradeable.OwnershipTransferred(tao, address(0));
        vm.prank(tao);
        certificates.setGovernance(linked);
        assertEq(certificates.governance(), linked);
        assertEq(certificates.owner(), address(0));
    }

    /// Audit: a TAO key, malicious or compromised, repointed the registry at a
    /// contract of its own, which revoked any certificate for good and wrote
    /// records in any TI's name. Governance is now set once, for good.
    function test_RevertWhen_TheTaoRepointsALinkedRegistry() public {
        PermissiveGovernance fake = new PermissiveGovernance(address(registry));
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, tao));
        vm.prank(tao);
        registry.setGovernance(address(fake));
        assertEq(registry.governance(), address(governance));

        // Nor can any key take a power to do it.
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, tao));
        vm.prank(tao);
        registry.transferOwnership(outsider);
    }

    function test_RevertWhen_AnyoneButTheOwnerLinksGovernance() public {
        CertificateRegistry certificates = _unlinked();
        address linked = _governanceOf(certificates);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, A));
        vm.prank(A);
        certificates.setGovernance(linked);
    }

    function test_RevertWhen_GovernanceHasNoCode() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
        vm.prank(tao);
        certificates.setGovernance(makeAddr("nothing"));
    }

    /// A link cannot be undone, so a governance contract made for another
    /// registry is refused rather than linked for good by mistake.
    function test_RevertWhen_GovernanceNamesAnotherRegistry() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
        vm.prank(tao);
        certificates.setGovernance(address(governance));
    }

    /// Whatever a contract answers that is not this registry's address is
    /// refused alike: nothing, too much, or an address with dirty high bits.
    function test_RevertWhen_GovernanceAnswersSomethingElseThanAnAddress() public {
        CertificateRegistry certificates = _unlinked();
        bytes[3] memory answers = [
            bytes(""),
            abi.encode(address(certificates), uint256(0)),
            abi.encode(uint256(uint160(address(certificates))) | (uint256(1) << 255))
        ];
        for (uint256 i = 0; i < answers.length; i++) {
            Answering answering = new Answering(answers[i]);
            vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
            vm.prank(tao);
            certificates.setGovernance(address(answering));
        }
    }

    /// A registry without an owner could never be linked, so none is made.
    function test_RevertWhen_TheRegistryIsInitializedWithoutAnOwner() public {
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableInvalidOwner.selector, address(0)));
        new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (address(0))));
    }

    /// A refused link changes nothing: the owner still links the right one.
    function test_ARefusedLinkLeavesTheRegistryToBeLinked() public {
        CertificateRegistry certificates = _unlinked();
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
        certificates.setGovernance(address(governance));
        assertEq(certificates.owner(), tao);
        assertEq(certificates.governance(), address(0));

        address linked = _governanceOf(certificates);
        vm.prank(tao);
        certificates.setGovernance(linked);
        assertEq(certificates.governance(), linked);
    }

    /// Until it is linked, a registry records nothing: no one answers who may
    /// sign.
    function test_RevertWhen_AnUnlinkedRegistryRecordsACertificate() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectRevert();
        vm.prank(A);
        certificates.registerCertificate(ID_HASH, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_GovernanceNamesNoRegistry() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
        vm.prank(tao);
        certificates.setGovernance(address(registry));
    }

    function test_RevertWhen_TheTaoRenouncesAnUnlinkedRegistry() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectRevert(IGovernanceTypes.OwnershipNotRenounceable.selector);
        vm.prank(tao);
        certificates.renounceOwnership();
        assertEq(certificates.owner(), tao);
    }

    function test_ExecutionNamesWhoExecutedNotGovernance() public {
        bytes32 key = _register();
        uint256 id = propose(A, key, IGovernanceTypes.ActionType.SUSPEND, REASON);
        vm.prank(B);
        governance.signProposal(id);
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateStandingChanged(key, IGovernanceTypes.Standing.SUSPENDED, id, REASON, B);
        vm.prank(B);
        governance.execute(id);
    }

    function test_InitializationNamesTheCertificateRegistry() public {
        CertificateRegistry certificates = _unlinked();
        vm.expectEmit();
        emit IStatusProposals.CertificateRegistryChanged(address(certificates));
        assertEq(IStatusProposals(_governanceOf(certificates)).certificateRegistry(), address(certificates));
    }

    /// Governance's registry is fixed by its initializer: no key repoints it.
    function test_GovernanceCannotBeRepointedAtAnotherRegistry() public {
        vm.prank(tao);
        (bool ok,) =
            address(governance).call(abi.encodeWithSignature("setCertificateRegistry(address)", address(_unlinked())));
        assertFalse(ok, "there is no setCertificateRegistry");
        assertEq(governance.certificateRegistry(), address(registry));
    }

    function test_RevertWhen_TheCertificateRegistryHasNoCode() public {
        vm.expectRevert(IGovernanceTypes.InvalidRegistry.selector);
        new BeaconProxy(
            address(beacon), abi.encodeCall(CertificateGovernance.initialize, (taoDid, makeAddr("nothing")))
        );
    }

    function test_AdvertisesItsInitializerToTheFactory() public view {
        assertEq(registry.getImplementationInitSelector(), CertificateRegistry.initialize.selector);
        assertTrue(registry.supportsInterface(0xf622b441));
    }
}

/// The audit's governance stand-in: lets anyone act, and names whatever
/// registry it is given.
contract PermissiveGovernance {
    address public certificateRegistry;

    constructor(address certificateRegistry_) {
        certificateRegistry = certificateRegistry_;
    }

    function requireActiveSigner(bytes32, address) external pure {}

    function requireSigner(bytes32, address) external pure {}
}

/// Answers every call with the same bytes.
contract Answering {
    bytes private answer;

    constructor(bytes memory answer_) {
        answer = answer_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return answer;
    }
}
