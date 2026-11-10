// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ICertificateGovernance} from "../contracts/interfaces/ICertificateGovernance.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
import {GovernanceConfigFile} from "./GovernanceConfigFile.sol";
import {Networks} from "./Networks.sol";

/**
 * Act on rule changes as the supervisory authority (component 10.4).
 *
 * Loosening the multisig - a lower threshold, a shorter timelock, revocation
 * without the supervisory authority, a different set of keys - is opened by
 * the supervisory authority; the certification body's keys co-sign only after
 * it (plr.services.governance.check_admin_change). The supervisory authority
 * signs from its own wallet, in the console's wallet mode. This script is the
 * pilot's stand-in for that wallet.
 *
 * Usage (`npm run supervisor:besu` is the forge script with --rpc-url and --broadcast):
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=set_policy KIND=revoke THRESHOLD=2 REQUIRED=C VETO=A,B,C TIMELOCK=86400 npm run supervisor:besu
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=add_signer SUBJECT=0x… ROLE=C   (a backup key)
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=replace_signer SUBJECT=0x… REPLACEMENT=0x…
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=remove_signer SUBJECT=0x…
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=set_proposal_ttl TTL=2592000
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… SIGN=12 | EXECUTE=12 | CANCEL=12
 *
 * SUPERVISOR_KEY is the key of role C. On a development chain it defaults to
 * whichever development key holds role C.
 */
contract SupervisorAdmin is Script, GovernanceConfigFile, Networks {
    Role internal constant SUPERVISORY = Role.wrap(3);

    function run() external {
        address governanceAddress = vm.envOr("GOVERNANCE", vm.envOr("PLR_GOVERNANCE_CONTRACT", address(0)));
        require(governanceAddress != address(0), "GOVERNANCE is the contract address.");
        ICertificateGovernance governance = ICertificateGovernance(governanceAddress);
        bytes32 tiId = governance.computeTiId(vm.envString("TI_DID"));
        uint256 key = _supervisorKey(governance, tiId);

        string[3] memory acts = ["SIGN", "EXECUTE", "CANCEL"];
        for (uint256 i = 0; i < 3; i++) {
            uint256 id = vm.envOr(acts[i], uint256(0));
            if (id == 0) continue;
            vm.broadcast(key);
            if (i == 0) governance.signAdminProposal(id);
            else if (i == 1) governance.executeAdminProposal(id);
            else governance.cancelAdminProposal(id);
            string[3] memory done = ["signed", "executed", "vetoed"];
            console.log(string.concat("supervisory authority ", done[i], " rule change #", vm.toString(id)));
            return;
        }

        string memory action = vm.envOr("ACTION", string(""));
        vm.broadcast(key);
        uint256 opened = _propose(governance, tiId, action);
        console.log(string.concat("supervisory authority opened rule change #", vm.toString(opened), ": ", action));
    }

    function _propose(ICertificateGovernance governance, bytes32 tiId, string memory action) internal returns (uint256) {
        bytes32 a = keccak256(bytes(action));
        if (a == keccak256("set_policy")) {
            string[] memory veto = _roleList("VETO");
            // Who may veto is restated with every policy change, never left implied.
            require(veto.length > 0, "VETO names the roles that may veto under the new policy, e.g. VETO=A,B,C.");
            return governance.proposePolicy(
                tiId,
                _kind(vm.envString("KIND")),
                uint8(vm.envUint("THRESHOLD")),
                _mask(_roleList("REQUIRED")),
                _mask(veto),
                uint64(vm.envOr("TIMELOCK", uint256(0)))
            );
        }
        if (a == keccak256("add_signer")) {
            return governance.proposeAddSigner(tiId, vm.envAddress("SUBJECT"), _role(vm.envString("ROLE")));
        }
        if (a == keccak256("replace_signer")) {
            return governance.proposeReplaceSigner(tiId, vm.envAddress("SUBJECT"), vm.envAddress("REPLACEMENT"));
        }
        if (a == keccak256("remove_signer")) return governance.proposeRemoveSigner(tiId, vm.envAddress("SUBJECT"));
        if (a == keccak256("set_proposal_ttl")) return governance.proposeProposalTtl(tiId, uint64(vm.envUint("TTL")));
        revert(
            string.concat(
                "no rule change called '",
                action,
                "': ACTION is set_policy, add_signer, replace_signer, remove_signer or set_proposal_ttl",
                " (or SIGN, EXECUTE, CANCEL a rule change by its number)"
            )
        );
    }

    /// Role letters from a comma-separated variable; unset or empty is none.
    function _roleList(string memory name) internal view returns (string[] memory letters) {
        string memory raw = vm.trim(vm.envOr(name, string("")));
        if (bytes(raw).length == 0) return new string[](0);
        letters = vm.split(raw, ",");
        for (uint256 i = 0; i < letters.length; i++) {
            letters[i] = vm.trim(letters[i]);
        }
    }

    function _kind(string memory name) internal pure returns (IGovernanceTypes.PolicyKind) {
        string[4] memory kinds = _policyKinds();
        for (uint256 i = 0; i < 4; i++) {
            if (keccak256(bytes(kinds[i])) == keccak256(bytes(name))) return IGovernanceTypes.PolicyKind(i);
        }
        revert(string.concat("KIND is suspend, revoke, reinstate or admin, not ", name));
    }

    function _supervisorKey(ICertificateGovernance governance, bytes32 tiId) internal view returns (uint256 key) {
        key = vm.envOr("SUPERVISOR_KEY", uint256(0));
        if (key == 0 && _isDevelopment()) {
            for (uint256 i = 0; i < 20; i++) {
                if (Role.unwrap(governance.roleOf(tiId, _developmentAccount(i))) == Role.unwrap(SUPERVISORY)) {
                    key = _developmentKey(i);
                    break;
                }
            }
        }
        require(key != 0, "Set SUPERVISOR_KEY to the key of the supervisory authority's role C.");
        require(
            Role.unwrap(governance.roleOf(tiId, vm.addr(key))) == Role.unwrap(SUPERVISORY),
            "SUPERVISOR_KEY does not hold the supervisory authority's role C."
        );
    }
}
