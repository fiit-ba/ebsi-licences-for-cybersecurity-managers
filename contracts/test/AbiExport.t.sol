// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {stdJson} from "forge-std/StdJson.sol";
import {GovernanceTest} from "./GovernanceTest.sol";

/**
 * The back-office's server and its console read the contract's interface
 * from generated copies (scripts/export-abi.js). These tests read the
 * back-office's copy. That every copy matches the compiled contract, and that
 * every set of roles is named a `...Mask` (D21), is
 * `node scripts/export-abi.js --check`, run next to `forge test`.
 */
contract AbiExportTest is GovernanceTest {
    using stdJson for string;

    string internal generated;

    function setUp() public override {
        super.setUp();
        generated = vm.readFile(
            string.concat(vm.projectRoot(), "/../back-office/shared/governance-contract.json")
        );
    }

    function test_AProposalHoldsNothingButACertificatesKeyAndNeutralMetadata() public view {
        // Privacy (components 10.3, 10.8): no holder DID, no licence number, no
        // reason, no supporting documents - the reason only as a salted
        // commitment (D22); the proposer and signatures are role keys (10.4).
        string[11] memory expected = [
            "tiId",
            "statusKey",
            "actionType",
            "reasonHash",
            "proposedAt",
            "quorumReachedAt",
            "state",
            "signatures",
            "executableAt",
            "rolesSignedMask",
            "proposer"
        ];
        string memory fields = string.concat(_function("getProposal"), ".outputs[0].components");
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(_string(string.concat(_at(fields, i), ".name")), expected[i]);
        }
        assertFalse(generated.keyExists(_at(fields, expected.length)), "no other field");
    }

    function test_CarriesTheContractsOwnBoundsAsTheDeployedContractHasThem() public view {
        // Read from the source; the back-office checks its settings against them.
        string[] memory names = vm.parseJsonKeys(generated, ".limits");
        assertEq(names.length, 4);
        assertEq(generated.readUint(".limits.MAX_TRUST_CHAIN_DEPTH"), governance.MAX_TRUST_CHAIN_DEPTH());
        assertEq(generated.readUint(".limits.MAX_ROLE"), governance.MAX_ROLE());
        assertEq(generated.readUint(".limits.MAX_TIMELOCK"), governance.MAX_TIMELOCK());
        assertEq(generated.readUint(".limits.MAX_PROPOSAL_TTL"), governance.MAX_PROPOSAL_TTL());
    }

    // -----------------------------------------------------------------------

    /// The path of the ABI entry for the function `name`.
    function _function(string memory name) private view returns (string memory) {
        for (uint256 i = 0; generated.keyExists(_at(".abi", i)); i++) {
            if (_eq(_string(string.concat(_at(".abi", i), ".name")), name)) return _at(".abi", i);
        }
        revert(string.concat("no function ", name, " in the ABI"));
    }

    function _string(string memory path) private view returns (string memory) {
        return generated.keyExists(path) ? generated.readString(path) : "";
    }

    function _at(string memory path, uint256 i) private pure returns (string memory) {
        return string.concat(path, "[", vm.toString(i), "]");
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
