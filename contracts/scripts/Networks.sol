// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";

/**
 * Which chain a script runs on, and the development accounts that are
 * acceptable only on a development chain.
 */
abstract contract Networks is CommonBase {
    /// The standard development mnemonic: the local Besu network's genesis
    /// accounts and anvil's. Its private keys are public knowledge.
    string internal constant DEVELOPMENT_MNEMONIC = "test test test test test test test test test test test junk";

    uint256 internal constant BESU_CHAIN_ID = 1337; // infra/besu/besu-qbft-network
    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    /// Who each development key is on a development chain, by its index in
    /// the mnemonic. Every role has a key of its own, so a script or a test
    /// shows which role acts.
    /// Deploys and administers the EBSI contracts, and owns the beacons.
    uint256 internal constant DEVELOPMENT_DEPLOYER = 0;
    /// The TI's #key-1, its signer of role A.
    uint256 internal constant DEVELOPMENT_SIGNER_A = 1;
    /// The TI's #key-2, its signer of role B.
    uint256 internal constant DEVELOPMENT_SIGNER_B = 2;
    uint256 internal constant DEVELOPMENT_ROOT_TAO = 3;
    /// The TAO, owner of both contracts.
    uint256 internal constant DEVELOPMENT_TAO = 4;
    /// NBÚ, whose DID cosigns as role C. The local Besu network's genesis
    /// funds keys 0 to 4 only; SeedEbsi.s.sol gives this one its gas.
    uint256 internal constant DEVELOPMENT_NBU = 5;

    /// Chains on which the development keys are acceptable.
    function _isDevelopment() internal view returns (bool) {
        return block.chainid == BESU_CHAIN_ID || block.chainid == ANVIL_CHAIN_ID;
    }

    /// The name the deployment record goes by: besu, anvil, or GOVERNANCE_NETWORK
    /// (default "ledger") for any other chain.
    function _networkName() internal view returns (string memory) {
        if (block.chainid == BESU_CHAIN_ID) return "besu";
        if (block.chainid == ANVIL_CHAIN_ID) return "anvil";
        return vm.envOr("GOVERNANCE_NETWORK", string("ledger"));
    }

    /// deployments/<network>.json
    function _recordFile() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", _networkName(), ".json");
    }

    function _developmentKey(uint256 index) internal pure returns (uint256) {
        return vm.deriveKey(DEVELOPMENT_MNEMONIC, uint32(index));
    }

    function _developmentAccount(uint256 index) internal pure returns (address) {
        return vm.addr(_developmentKey(index));
    }

    /// True for the first 20 accounts of the development mnemonic.
    function _isDevelopmentAccount(address account) internal pure returns (bool) {
        for (uint256 i = 0; i < 20; i++) {
            if (_developmentAccount(i) == account) return true;
        }
        return false;
    }
}
