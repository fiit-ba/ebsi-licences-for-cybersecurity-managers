// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";

/**
 * Each module keeps its state in its own ERC-7201 namespace, so a module can
 * grow across a beacon upgrade without moving another's storage. A mistyped
 * location constant would still pass every other test.
 */
contract StorageNamespacesTest is GovernanceTest {
    // Computed ahead: sha256 is a call, and would take a pending prank.
    bytes32 internal ID_HASH;

    function setUp() public override {
        super.setUp();
        ID_HASH = Hashes.certificateIdHash("urn:uuid:storage");
    }

    function _location(string memory id) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function _load(bytes32 slot) internal view returns (bytes32) {
        return vm.load(address(governance), slot);
    }

    function test_TheRegistriesLiveInTheirNamespace() public view {
        bytes32 location = _location("plr.storage.TiAccreditation");
        assertEq(_load(location), bytes32(uint256(uint160(didRegistry))));
        assertEq(_load(bytes32(uint256(location) + 1)), bytes32(uint256(uint160(issuersRegistry))));
    }

    function test_TisLiveInTheirNamespace() public view {
        bytes32 location = _location("plr.storage.TiConfiguration");
        bytes32 ti = keccak256(abi.encode(TI_ID, location));
        assertEq(_load(bytes32(uint256(ti) + 1)), governance.getTi(TI_ID).attributeId);
    }

    function test_CertificatesLiveInTheirNamespace() public {
        vm.prank(A);
        bytes32 statusKey = registry.registerCertificate(
            ID_HASH, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID
        );
        bytes32 location = _location("plr.storage.CertificateRegistry");
        assertEq(vm.load(address(registry), location), bytes32(uint256(uint160(address(governance)))));
        bytes32 record = keccak256(abi.encode(statusKey, uint256(location) + 1));
        // Standing and three dates fill a slot; the fourth date takes the next.
        assertEq(vm.load(address(registry), bytes32(uint256(record) + 2)), CREDENTIAL_HASH);
    }

    function test_StatusProposalsLiveInTheirNamespace() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, keccak256("reason"));
        bytes32 location = _location("plr.storage.StatusProposals");
        assertEq(_load(location), bytes32(uint256(uint160(address(registry)))));
        assertEq(uint256(_load(bytes32(uint256(location) + 1))), 1);
    }

    function test_RuleChangesLiveInTheirNamespace() public {
        vm.prank(A);
        governance.proposeProposalTtl(TI_ID, 1 days);
        assertEq(uint256(_load(_location("plr.storage.RuleChanges"))), 1);
    }

    function test_NothingLivesInTheSequentialSlots() public {
        vm.prank(A);
        registry.registerCertificate(
            ID_HASH, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID
        );
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, keccak256("reason"));
        vm.prank(A);
        governance.proposeProposalTtl(TI_ID, 1 days);
        for (uint256 slot = 0; slot < 64; slot++) {
            assertEq(_load(bytes32(slot)), bytes32(0));
            assertEq(vm.load(address(registry), bytes32(slot)), bytes32(0));
        }
    }
}
