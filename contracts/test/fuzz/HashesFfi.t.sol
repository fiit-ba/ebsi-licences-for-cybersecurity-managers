pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";

/**
 * The hashes on any input, against an implementation that shares no code
 * with the contracts: test/vectors/hash.py, its own ABI encoder and Python's
 * hashlib. test/HashVectors.t.sol checks a few chosen cases; this checks
 * whatever the fuzzer finds, bytes that are not UTF-8 among them.
 *
 * It runs Python through ffi, which the default profile does not allow:
 *
 *   FOUNDRY_PROFILE=ffi forge test --match-path test/fuzz/HashesFfi.t.sol
 *
 * Without it, the tests skip.
 */
contract HashesFfiTest is Test {
    function testFuzz_ACertificateIdHashIsPythons(bytes memory id) public {
        string[] memory command = _command("certificate-id", 1);
        command[3] = vm.toString(id);
        _expect(command, Hashes.certificateIdHash(string(id)));
    }

    function testFuzz_AStatusKeyIsPythons(bytes memory did, bytes memory id) public {
        string[] memory command = _command("status-key", 2);
        command[3] = vm.toString(did);
        command[4] = vm.toString(id);
        _expect(command, Hashes.statusKey(string(did), Hashes.certificateIdHash(string(id))));
    }

    function testFuzz_AReasonIsPythons(bytes memory code, bytes memory note, bytes32 salt) public {
        string[] memory command = _command("reason", 3);
        command[3] = vm.toString(code);
        command[4] = vm.toString(note);
        command[5] = vm.toString(salt);
        _expect(command, Hashes.reason(string(code), string(note), salt));
    }

    function _command(string memory kind, uint256 arguments) private pure returns (string[] memory command) {
        command = new string[](3 + arguments);
        command[0] = "python3";
        command[1] = "test/vectors/hash.py";
        command[2] = kind;
    }

    function _expect(string[] memory command, bytes32 expected) private {
        // When ffi is off, the cheatcode reverts and the test skips.
        try vm.ffi(command) returns (bytes memory answer) {
            assertEq(answer.length, 32, "Python's answer");
            assertEq(bytes32(answer), expected);
        } catch {
            vm.skip(true);
        }
    }
}
