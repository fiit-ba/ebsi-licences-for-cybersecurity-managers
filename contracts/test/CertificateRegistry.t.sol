// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {GovernanceTest} from "./GovernanceTest.sol";

/// The boundary between the two contracts (D39): the registry takes its signers
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

    function test_RevertWhen_AGovernanceAppliesAProposalToAnUnknownCertificate() public {
        vm.prank(tao);
        registry.setGovernance(address(this));
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        registry.applyExecuted(TI_ID, keccak256("no record"), IGovernanceTypes.ActionType.REVOKE, 1, REASON, tao);
    }

    function test_RevertWhen_AGovernanceAppliesAProposalToAnotherTisCertificate() public {
        bytes32 key = _register();
        vm.prank(tao);
        registry.setGovernance(address(this));
        vm.expectRevert(IGovernanceTypes.NotCertificateIssuer.selector);
        registry.applyExecuted(keccak256("other"), key, IGovernanceTypes.ActionType.REVOKE, 1, REASON, tao);
    }

    function test_TheTaoOwnsTheRegistry() public view {
        assertEq(registry.owner(), tao);
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

    function test_RevertWhen_AnyoneButTheTaoChangesGovernance() public {
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, A));
        vm.prank(A);
        registry.setGovernance(address(governance));
    }

    function test_RevertWhen_GovernanceHasNoCode() public {
        vm.expectRevert(IGovernanceTypes.InvalidGovernance.selector);
        vm.prank(tao);
        registry.setGovernance(makeAddr("nothing"));
    }

    function test_RevertWhen_TheTaoRenouncesTheRegistry() public {
        vm.expectRevert(IGovernanceTypes.OwnershipNotRenounceable.selector);
        vm.prank(tao);
        registry.renounceOwnership();
        assertEq(registry.owner(), tao);
    }

    function test_TheTaoRepointsGovernance() public {
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.GovernanceChanged(address(this));
        vm.prank(tao);
        registry.setGovernance(address(this));
        assertEq(registry.governance(), address(this));
    }

    function test_TheOldGovernanceLosesTheRegistry() public {
        uint256 id = propose(A, _register(), IGovernanceTypes.ActionType.SUSPEND, REASON);
        vm.prank(B);
        governance.signProposal(id);
        vm.prank(tao);
        registry.setGovernance(address(this));
        vm.expectRevert(IGovernanceTypes.NotGovernance.selector);
        vm.prank(A);
        governance.execute(id);
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

    function test_TheTaoRepointsTheCertificateRegistry() public {
        address replacement = address(registry);
        vm.expectEmit(address(governance));
        emit IStatusProposals.CertificateRegistryChanged(replacement);
        vm.prank(tao);
        governance.setCertificateRegistry(replacement);
    }

    function test_RevertWhen_TheCertificateRegistryHasNoCode() public {
        vm.expectRevert(IGovernanceTypes.InvalidRegistry.selector);
        vm.prank(tao);
        governance.setCertificateRegistry(makeAddr("nothing"));
    }

    function test_RevertWhen_AnyoneButTheTaoRepointsTheCertificateRegistry() public {
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, A));
        vm.prank(A);
        governance.setCertificateRegistry(address(registry));
    }

    function test_AdvertisesItsInitializerToTheFactory() public view {
        assertEq(registry.getImplementationInitSelector(), CertificateRegistry.initialize.selector);
        assertTrue(registry.supportsInterface(0xf622b441));
    }
}
