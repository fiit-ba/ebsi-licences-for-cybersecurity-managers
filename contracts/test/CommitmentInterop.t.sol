// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";

/**
 * Cross-implementation check for what the back-office and the contract both
 * compute: a status change's reason (D22) and a certificate's status key (D41).
 * If the two ever disagree, a verifier or an audit fails while everything else
 * keeps working - a silent break that no single-language test would catch.
 *
 * So rather than asserting against a hardcoded digest, this runs the real
 * TypeScript implementation (back-office/server/issuance/protection.ts,
 * through `vm.ffi` and Node) and compares it with the real Solidity one.
 *
 * Node runs the back-office's TypeScript directly, as the back-office itself
 * does (Node 24). PLR_NODE names another interpreter; the default is `node`.
 * Without one the tests are skipped locally and fail on CI, where a skip
 * would let a real divergence hide behind a missing tool.
 */
contract CommitmentInteropTest is GovernanceTest {
    string internal constant ISSUER = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";

    struct Case {
        string name;
        string issuerDid;
        string certificateId;
    }

    struct Reason {
        string name;
        string code;
        string note;
        string salt; // as the back-office keeps it: hex, with or without 0x
    }

    string internal node;
    string internal hashes;

    function setUp() public override {
        super.setUp();
        hashes = string.concat(vm.projectRoot(), "/../back-office/server/issuance/protection.ts");
        node = vm.envOr("PLR_NODE", string("node"));

        if (!_backOfficeWorks()) {
            string memory why = string.concat(
                node,
                " cannot import ",
                hashes,
                "; set PLR_NODE to a Node 24 interpreter"
            );
            if (vm.envOr("CI", false)) revert(why);
            vm.skip(true, why);
        }
    }

    /// Cases chosen to catch encoding disagreements, not just the happy path.
    function _cases() internal pure returns (Case[5] memory) {
        return [
            Case("a credential's id", ISSUER, "urn:uuid:3f1a9c2b-7e4d-4056-a1b3-c5d7e9f02134"),
            Case("an id with diacritics", ISSUER, unicode"urn:uuid:č-17"),
            Case("a DID and an id that concatenate alike", string.concat(ISSUER, "2"), "48"),
            Case(
                "a DID longer than one ABI word",
                "did:ebsi:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
                "7"
            ),
            Case(
                "an id longer than one ABI word",
                ISSUER,
                "PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-PLR-"
            )
        ];
    }

    /// Reasons (D22): a category, a note, and a salt of the proposal's own.
    function _reasons() internal pure returns (Reason[4] memory) {
        return [
            Reason(
                "a category alone",
                "conditions_not_met",
                "",
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
            ),
            Reason(
                "a note with diacritics",
                "other",
                unicode"Doklady o vzdelaní boli sfalšované",
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            ),
            Reason(
                "a note longer than one ABI word",
                "supervisory_decision",
                "rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie rozhodnutie ",
                "1111111111111111111111111111111111111111111111111111111111111111"
            ),
            Reason(
                "a reinstatement without a reason",
                "none",
                "",
                "0x2222222222222222222222222222222222222222222222222222222222222222"
            )
        ];
    }

    function test_TheyAgreeOnACertificatesStatusKey() public {
        Case[5] memory cases = _cases();
        for (uint256 i = 0; i < cases.length; i++) {
            Case memory c = cases[i];
            assertEq(
                registry.computeStatusKey(c.issuerDid, c.certificateId),
                _backOfficeStatusKey(c),
                string.concat("case: ", c.name)
            );
        }
    }

    function test_TheyAgreeOnTheReasonsCommitmentToo() public {
        Reason[4] memory reasons = _reasons();
        for (uint256 i = 0; i < reasons.length; i++) {
            Reason memory r = reasons[i];
            assertEq(
                governance.computeReasonHash(r.code, r.note, _bytes32(r.salt)),
                _backOfficeReasonHash(r),
                string.concat("reason: ", r.name)
            );
        }
    }

    function test_AProposalOpenedWithABackOfficeReasonVerifiesOnChain() public {
        // The back-office commits to the reason and opens the proposal; the
        // auditor, given its disclosure, confirms it against the ledger (D22).
        Reason memory r = _reasons()[1];
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, _backOfficeReasonHash(r));
        assertTrue(governance.verifyProposalReason(1, r.code, r.note, _bytes32(r.salt)));
    }

    // -----------------------------------------------------------------------

    function _backOfficeStatusKey(Case memory c) internal returns (bytes32) {
        string[] memory command = _node(
            "const [did, id] = process.argv.slice(1); "
            "process.stdout.write('0x' + m.certificateStatusKey(did, id).toString('hex'));"
        );
        // The third goes along unread: _with takes at least three arguments.
        return bytes32(vm.ffi(_with(command, c.issuerDid, c.certificateId, "", "")));
    }

    function _backOfficeReasonHash(Reason memory r) internal returns (bytes32) {
        string[] memory command = _node(
            "const [code, note, salt] = process.argv.slice(1); "
            "const bytes = Buffer.from(salt.replace(/^0x/, ''), 'hex'); "
            "process.stdout.write('0x' + m.reasonCommitment(code, note, bytes).toString('hex'));"
        );
        return bytes32(vm.ffi(_with(command, r.code, r.note, r.salt, "")));
    }

    /// True when `node` runs and imports the back-office's hash code.
    function _backOfficeWorks() internal returns (bool) {
        try vm.tryFfi(_node("process.exit(typeof m.certificateStatusKey === 'function' ? 0 : 1);")) returns (
            Vm.FfiResult memory result
        ) {
            return result.exitCode == 0;
        } catch {
            return false; // no such interpreter
        }
    }

    /// `node` running `code` with the back-office's hash module bound to `m`.
    function _node(string memory code) internal view returns (string[] memory command) {
        command = new string[](4);
        command[0] = node;
        command[1] = "--input-type=module";
        command[2] = "-e";
        command[3] = string.concat("const m = await import('", hashes, "'); ", code);
    }

    /// `command` with arguments appended; an empty last one is left out.
    function _with(string[] memory command, string memory a, string memory b, string memory c, string memory d)
        internal
        pure
        returns (string[] memory full)
    {
        uint256 n = bytes(d).length == 0 ? 3 : 4;
        full = new string[](command.length + n);
        for (uint256 i = 0; i < command.length; i++) {
            full[i] = command[i];
        }
        full[command.length] = a;
        full[command.length + 1] = b;
        full[command.length + 2] = c;
        if (n == 4) full[command.length + 3] = d;
    }

    /// The salt as the contract takes it.
    function _bytes32(string memory salt) internal pure returns (bytes32) {
        bytes memory raw = bytes(salt);
        if (raw.length >= 2 && raw[0] == "0" && raw[1] == "x") return vm.parseBytes32(salt);
        return vm.parseBytes32(string.concat("0x", salt));
    }
}
