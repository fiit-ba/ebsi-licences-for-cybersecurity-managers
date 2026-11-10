// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ICertificateGovernance as G} from "../contracts/interfaces/ICertificateGovernance.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {GovernanceConfigFile} from "./GovernanceConfigFile.sol";
import {Networks} from "./Networks.sol";

/**
 * Exercise the deployed contract on a development chain: print its signers and
 * policies, record a certificate, then run a suspension to execution, an audit
 * verification, a revocation held by its timelock and a veto of it - what the
 * back-office's reconciler then reads.
 *
 * Usage: npm run verify:besu   (after npm run deploy:besu)
 *
 * The TI must be set up first (scripts/AddTi.s.sol), with the development
 * keys as its signers. The contract is the one in deployments/<network>.json,
 * or GOVERNANCE. It
 * signs with the development keys the contract was deployed with, so it runs
 * before bootstrap rotates roles A and B to their KMS keys.
 */
contract VerifyOnchain is Script, GovernanceConfigFile, Networks {
    string internal constant ISSUER = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    /// The credential's id, new on every run (set by run()).
    string internal certificateId;
    bytes32 internal tiId;

    function run() external {
        require(_isDevelopment(), "VerifyOnchain signs with the development keys: run it on a development chain.");
        G gov = G(_governance());
        tiId = gov.computeTiId(ISSUER);
        _printConfiguration(gov);

        // Recorded as the back-office records a collected certificate: under
        // its id's hash, with the hash of the credential (D41, D42).
        certificateId = string.concat("urn:uuid:verify-onchain-", vm.toString(vm.unixTime()));
        ICertificateRegistry registry = ICertificateRegistry(gov.certificateRegistry());
        bytes32 idHash = Hashes.certificateIdHash(certificateId);
        // Computed ahead: sha256 is a call, and none may follow vm.broadcast.
        bytes32 credentialHash = sha256(bytes(certificateId));
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_A));
        bytes32 statusKey = registry.registerCertificate(
            idHash, ISSUER, uint64(vm.unixTime() / 1000), 0, credentialHash, IGovernanceTypes.Standing.VALID
        );
        console.log("\nstatus key  :", vm.toString(statusKey));
        // Why: a salted commitment of the reason goes on chain with the
        // proposal (DECISIONS.md D22); the reason itself stays in the back-office.
        bytes32 reasonSalt = bytes32(vm.randomUint());

        vm.recordLogs();
        _suspend(gov, registry, statusKey, reasonSalt);
        _revokeAndVeto(gov, statusKey, reasonSalt);
        _printExecuted(vm.getRecordedLogs());
    }

    function _printConfiguration(G gov) internal view {
        console.log("contract    :", address(gov));
        IGovernanceTypes.TiView memory ti = gov.getTi(tiId);
        for (uint256 i = 0; i < ti.signers.length; i++) {
            console.log(string.concat("signer      : ", _letter(ti.roles[i]), "  ", vm.toString(ti.signers[i])));
        }
        string[4] memory kinds = ["suspend  ", "revoke   ", "reinstate", "admin    "];
        for (uint256 i = 0; i < 4; i++) {
            IGovernanceTypes.Policy memory p = ti.policies[i];
            string memory required = _letters(p.requiredRoleMask);
            console.log(
                string.concat(
                    "policy      : ",
                    kinds[i],
                    " ",
                    vm.toString(p.threshold),
                    " roles",
                    bytes(required).length > 0 ? string.concat(" incl. ", required) : "",
                    ", veto ",
                    _letters(p.vetoRoleMask),
                    ", timelock ",
                    vm.toString(p.timelock),
                    "s"
                )
            );
        }
    }

    function _suspend(G gov, ICertificateRegistry registry, bytes32 statusKey, bytes32 reasonSalt) internal {
        console.log("\n--- SUSPEND: 2-of-3, no timelock ---");
        bytes32 reason = gov.computeReasonHash("under_investigation", "", reasonSalt);
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_A));
        uint256 id = gov.proposeAction(tiId, statusKey, IGovernanceTypes.ActionType.SUSPEND, reason);
        _state("proposal", id, gov, IGovernanceTypes.ProposalState.PROPOSED);
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_B));
        gov.signProposal(id);
        _state("after B sign", id, gov, IGovernanceTypes.ProposalState.APPROVED);
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_A));
        gov.execute(id);
        _state("executed", id, gov, IGovernanceTypes.ProposalState.EXECUTED);
        console.log(string.concat("signatures  : ", _join(gov.getProposal(id).signatures)));

        // Audit verification (component 10.7) against the chain.
        bytes32 proposed = gov.getProposal(id).statusKey;
        bool ok = registry.computeStatusKey(ISSUER, certificateId) == proposed;
        bool bad = registry.computeStatusKey(ISSUER, string.concat(certificateId, "0")) == proposed;
        console.log(string.concat("\naudit verify: correct id = ", vm.toString(ok), " | wrong id = ", vm.toString(bad)));
        require(ok && !bad, "audit: the status key does not tell the certificate");
    }

    function _revokeAndVeto(G gov, bytes32 statusKey, bytes32 reasonSalt) internal {
        console.log("\n--- REVOKE: timelock must block execution ---");
        // The same certificate: the suspension is executed, so it is free again.
        bytes32 reason = gov.computeReasonHash("conditions_not_met", "", reasonSalt);
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_A));
        uint256 id = gov.proposeAction(tiId, statusKey, IGovernanceTypes.ActionType.REVOKE, reason);
        vm.broadcast(_developmentKey(DEVELOPMENT_SIGNER_B));
        gov.signProposal(id);
        _state("after quorum", id, gov, IGovernanceTypes.ProposalState.APPROVED);
        // Tried, not sent: a prank runs only in the script's simulation.
        vm.prank(_developmentAccount(DEVELOPMENT_SIGNER_A));
        try gov.execute(id) {
            revert("execute early: allowed before the timelock ended");
        } catch {
            console.log("execute early: correctly rejected");
        }

        console.log("\n--- VETO: supervisor stops the timelocked revocation ---");
        vm.broadcast(_developmentKey(DEVELOPMENT_NBU));
        gov.cancelProposal(id, bytes32(0));
        _state("after veto", id, gov, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// The events the back-office's reconciler reads, as this run emitted them.
    function _printExecuted(Vm.Log[] memory logs) internal pure {
        console.log("\n--- events the back-office reconciler reads ---");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != IStatusProposals.ProposalExecuted.selector) continue;
            console.log(
                string.concat(
                    "  ProposalExecuted id=",
                    vm.toString(uint256(logs[i].topics[1])),
                    " statusKey=",
                    vm.toString(logs[i].topics[2])
                )
            );
        }
    }

    function _join(address[] memory list) internal pure returns (string memory out) {
        for (uint256 i = 0; i < list.length; i++) {
            out = string.concat(out, i > 0 ? ", " : "", vm.toString(list[i]));
        }
    }

    function _governance() internal view returns (address governance) {
        governance = vm.envOr("GOVERNANCE", address(0));
        if (governance != address(0)) return governance;
        string memory file = _recordFile();
        require(vm.exists(file), string.concat("No ", file, ": deploy first, or set GOVERNANCE."));
        return vm.parseJsonAddress(vm.readFile(file), ".CertificateGovernance.address");
    }

    /// Prints a proposal's state, and stops the script unless it is `expected`.
    function _state(string memory label, uint256 id, G gov, IGovernanceTypes.ProposalState expected)
        internal
        view
    {
        IGovernanceTypes.ProposalState state = gov.stateOf(id);
        console.log(string.concat(label, ": proposal ", vm.toString(id), " ", _stateName(state)));
        require(state == expected, string.concat(label, ": expected ", _stateName(expected), ", got ", _stateName(state)));
    }

    function _stateName(IGovernanceTypes.ProposalState state) internal pure returns (string memory) {
        string[6] memory names = ["NONE", "PROPOSED", "APPROVED", "EXECUTED", "CANCELLED", "EXPIRED"];
        return names[uint8(state)];
    }
}
