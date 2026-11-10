// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ICertificateGovernance} from "../contracts/interfaces/ICertificateGovernance.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {GovernanceConfigFile} from "./GovernanceConfigFile.sol";
import {Networks} from "./Networks.sol";
import {SignerRotation} from "./SignerRotation.sol";

/**
 * Bring the governance contract's signers to a target set, through the
 * contract's own quorum (component 10.4, self-administration).
 *
 * Signers are not replaced by redeploying. A new contract would have new
 * proposal numbers, and every case file in the back-office that points at an
 * on-chain proposal would then point at the wrong one. Rotation is what the
 * admin proposals exist for: adding or removing a signer needs the same quorum
 * as a revocation, so no single key holder can change who the signers are.
 *
 * Usage:
 *   GOVERNANCE=0x… TI_DID=did:ebsi:… TARGET=0xRoleA,0xRoleB npm run rotate:besu
 *   forge script scripts/RotateSigners.s.sol --rpc-url <url> --broadcast --slow
 *
 * TARGET is the certification body's keys for roles A and B, in that order.
 * Each role's key is replaced in one step (REPLACE_SIGNER), so the quorum
 * never changes on the way. The supervisory authority's role C is never
 * touched: its key is the external signer's own (component 10.2).
 *
 * Approvals are signed by whichever of GOVERNANCE_APPROVER_KEYS are current
 * signers - on a development chain by default the genesis keys the contract
 * was deployed with. In production each approval is a separate key holder's
 * act, from their own custody; this script is the pilot's stand-in for that.
 * `--slow` matters: a signature must not reach the chain before its proposal.
 *
 * Idempotent: a signer already present is not added again, and when the set
 * already matches, nothing is sent. Also tops up the new signers' balances,
 * since a KMS key starts with nothing to pay gas with (MIN_BALANCE / TOP_UP,
 * in wei; default 0.5 and 10 ether).
 */
contract RotateSigners is Script, GovernanceConfigFile, Networks, SignerRotation {
    function _as(address account) internal override {
        vm.broadcast(account);
    }

    function run() external {
        address governanceAddress = vm.envOr("GOVERNANCE", vm.envOr("PLR_GOVERNANCE_CONTRACT", address(0)));
        address[] memory keys = vm.envOr("TARGET", ",", new address[](0));
        require(
            governanceAddress != address(0) && keys.length > 0 && keys.length <= 2,
            "Set GOVERNANCE to the contract and TARGET to the keys of roles A and B"
        );
        ICertificateGovernance governance = ICertificateGovernance(governanceAddress);
        bytes32 tiId = governance.computeTiId(vm.envString("TI_DID"));

        Target[] memory target = new Target[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            target[i] = Target(Role.wrap(uint8(i + 1)), keys[i]);
        }

        address[] memory accounts = _approverAccounts();
        _topUp(accounts[0], keys);

        uint256[] memory changes = _rotateSigners(governance, tiId, accounts, target);
        for (uint256 i = 0; i < changes.length; i++) {
            IGovernanceTypes.AdminProposalView memory change = governance.getAdminProposal(changes[i]);
            if (change.state == IGovernanceTypes.ProposalState.EXECUTED) {
                console.log("rotated    admin proposal", changes[i]);
            } else {
                console.log(
                    string.concat(
                        "waiting    admin proposal ",
                        vm.toString(changes[i]),
                        " waits for its timelock; execute it after ",
                        vm.toString(change.executableAt)
                    )
                );
            }
        }

        IGovernanceTypes.TiView memory ti = governance.getTi(tiId);
        console.log("");
        for (uint256 i = 0; i < ti.signers.length; i++) {
            console.log(string.concat("signer     ", _letter(ti.roles[i]), "  ", vm.toString(ti.signers[i])));
        }
    }

    /// The approvers' keys, remembered so the script can broadcast as each.
    function _approverAccounts() internal returns (address[] memory accounts) {
        uint256[] memory fallbackKeys = new uint256[](0);
        if (_isDevelopment()) {
            fallbackKeys = new uint256[](4);
            for (uint256 i = 0; i < 4; i++) {
                fallbackKeys[i] = _developmentKey(i);
            }
        }
        uint256[] memory approverKeys = vm.envOr("GOVERNANCE_APPROVER_KEYS", ",", fallbackKeys);
        require(approverKeys.length > 0, "Set GOVERNANCE_APPROVER_KEYS to the keys that approve the rotation");
        accounts = new address[](approverKeys.length);
        for (uint256 i = 0; i < approverKeys.length; i++) {
            accounts[i] = vm.rememberKey(approverKeys[i]);
        }
    }

    /// A KMS key starts with nothing to pay gas with.
    function _topUp(address funder, address[] memory keys) internal {
        uint256 minimum = vm.envOr("MIN_BALANCE", uint256(0.5 ether));
        uint256 amount = vm.envOr("TOP_UP", uint256(10 ether));
        for (uint256 i = 0; i < keys.length; i++) {
            if (keys[i].balance >= minimum) continue;
            vm.broadcast(funder);
            (bool sent,) = payable(keys[i]).call{value: amount}("");
            require(sent, "top-up failed");
            console.log("funded    ", keys[i]);
        }
    }
}
