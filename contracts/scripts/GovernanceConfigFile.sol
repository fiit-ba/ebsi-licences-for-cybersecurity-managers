// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";

/**
 * A deployment's configuration file (config/*.json), for the scripts and the
 * tests: the policies, in the order the constructor takes them (SUSPEND,
 * REVOKE, REINSTATE, ADMIN), and the proposal lifetime.
 *
 * Roles are named by letter, A for role 1 to H for role 8. Who may veto is
 * named for every policy rather than defaulted to every role (DECISIONS.md
 * D21): a configuration says it, or it does not load.
 */
abstract contract GovernanceConfigFile is CommonBase {
    using stdJson for string;

    /// The policies' names in the file, by PolicyKind.
    function _policyKinds() internal pure returns (string[4] memory) {
        return ["suspend", "revoke", "reinstate", "admin"];
    }

    /// `file` relative to the contracts directory.
    function _readConfig(string memory file)
        internal
        view
        returns (IGovernanceTypes.Policy[4] memory policies, uint64 proposalTtl)
    {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/", file));
        string[4] memory kinds = _policyKinds();
        for (uint256 i = 0; i < 4; i++) {
            string memory at = string.concat(".policies.", kinds[i]);
            require(json.keyExists(at), string.concat(file, " has no policy for ", kinds[i]));
            require(
                json.keyExists(string.concat(at, ".vetoRoles")),
                string.concat("the ", kinds[i], " policy does not say which roles may veto (vetoRoles)")
            );
            string memory required = string.concat(at, ".requiredRoles");
            string memory timelock = string.concat(at, ".timelock");
            policies[i] = IGovernanceTypes.Policy({
                threshold: uint8(json.readUint(string.concat(at, ".threshold"))),
                requiredRoleMask: json.keyExists(required) ? _mask(json.readStringArray(required)) : RoleSet.wrap(0),
                vetoRoleMask: _mask(json.readStringArray(string.concat(at, ".vetoRoles"))),
                timelock: json.keyExists(timelock) ? uint64(json.readUint(timelock)) : 0
            });
        }
        proposalTtl = uint64(json.readUint(".proposalTtl"));
    }

    /// The roles named by letter, as a set.
    function _mask(string[] memory letters) internal pure returns (RoleSet set) {
        for (uint256 i = 0; i < letters.length; i++) {
            set = set.with(_role(letters[i]));
        }
    }

    function _role(string memory letter) internal pure returns (Role) {
        bytes memory b = bytes(letter);
        require(b.length == 1 && b[0] >= "A" && b[0] <= "H", "a role is one letter, A to H");
        return Role.wrap(uint8(b[0]) - uint8(bytes1("A")) + 1);
    }

    function _letter(Role role) internal pure returns (string memory) {
        return string(abi.encodePacked(bytes1(uint8(bytes1("A")) + Role.unwrap(role) - 1)));
    }

    /// The roles in a set, by letter: "A, C".
    function _letters(RoleSet set) internal pure returns (string memory out) {
        for (uint8 r = 1; r <= 8; r++) {
            if (!set.contains(Role.wrap(r))) continue;
            out = bytes(out).length == 0 ? _letter(Role.wrap(r)) : string.concat(out, ", ", _letter(Role.wrap(r)));
        }
    }
}
