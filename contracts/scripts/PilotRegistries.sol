pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

// EBSI's DID Registry on its PILOT network: the default the governance
// implementation is built with (Deploy.s.sol), and where the development mock
// stands on anvil and in the tests.
address constant PILOT_DID_REGISTRY = 0x76C8190D7422e5fa2A0190Bc2313bab0b2afEC78;

// EBSI's Trusted Issuers Registry on its PILOT network, likewise.
address constant PILOT_ISSUERS_REGISTRY = 0x5C87455c82617579A10AD39C2DB3e60E846E7266;

/**
 * Puts a development mock at the address EBSI's PILOT network has the real
 * registry at, so the governance implementation, whose registries are
 * immutables, is the same bytecode locally as on the pilot.
 *
 * The pilot's addresses come from EBSI's own deployer and its nonce, so no
 * deployment here can reproduce them. Instead the address is given an
 * ERC1967Proxy's runtime code (it has no immutables: it only delegates to the
 * implementation in its EIP-1967 slot), the slot is set to the mock's
 * implementation, and `initialize` is then called through it as an ordinary
 * call, which sets up the proxy's storage as its constructor would have.
 */
abstract contract PilotRegistries is CommonBase {
    /// @param target The pilot's address of the registry.
    /// @param implementation The mock's implementation, already deployed.
    /// @param initData The `initialize` call, sent from the caller.
    /// @param onNode Whether to set the code on the node too (`anvil_setCode`,
    ///        `anvil_setStorageAt`), for a script broadcasting to anvil; a test
    ///        needs only its own state.
    function _proxyAtPilotAddress(address target, address implementation, bytes memory initData, bool onNode)
        internal
        returns (address)
    {
        // No check that the address is empty: forge runs a broadcasting script
        // twice, and the first run has set the code on the node already. On an
        // anvil that already has the registry, `initialize` refuses instead.
        bytes memory code = type(ERC1967Proxy).runtimeCode;
        bytes32 slot = ERC1967Utils.IMPLEMENTATION_SLOT;
        bytes32 value = bytes32(uint256(uint160(implementation)));
        // The script's own (simulated) state, and the test's.
        vm.etch(target, code);
        vm.store(target, slot, value);
        if (onNode) {
            vm.rpc("anvil_setCode", string.concat('["', vm.toString(target), '","', vm.toString(code), '"]'));
            vm.rpc(
                "anvil_setStorageAt",
                string.concat('["', vm.toString(target), '","', vm.toString(slot), '","', vm.toString(value), '"]')
            );
        }
        (bool ok, bytes memory reason) = target.call(initData);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
        return target;
    }
}
