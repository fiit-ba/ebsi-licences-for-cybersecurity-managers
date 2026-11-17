pragma solidity 0.8.26;

import {stdJson} from "forge-std/StdJson.sol";
import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";

/**
 * Known answers for the hashes the contracts share with every other
 * implementation: a certificate's id hash and status key, and a status
 * change's reason commitment.
 *
 * A verifier, a wallet and the issuer's back-office compute the same values
 * off chain. If one of them ever disagreed with the contracts, a verifier or
 * an audit would fail while everything else kept working, and no test in a
 * single language would notice. So the expected values sit in one file,
 * test/vectors/hashes.json, computed independently of this code by
 * test/vectors/generate.py (its own ABI encoder and Python's hashlib). The
 * contracts are checked against it here; every other implementation checks
 * itself against the same file.
 *
 * The cases catch encoding disagreements: diacritics, a DID and an id that
 * would concatenate alike, strings longer than one ABI word, an empty note, a
 * note that ends in a space.
 */
contract HashVectorsTest is GovernanceTest {
    using stdJson for string;

    string internal vectors;

    function setUp() public override {
        super.setUp();
        vectors = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/hashes.json"));
    }

    function test_TheStatusKeysAreTheKnownAnswers() public view {
        uint256 count;
        for (; vectors.keyExists(_at(".statusKeys", count)); count++) {
            string memory c = _at(".statusKeys", count);
            string memory name = vectors.readString(string.concat(c, ".name"));
            string memory issuerDid = vectors.readString(string.concat(c, ".issuerDid"));
            string memory certificateId = vectors.readString(string.concat(c, ".certificateId"));

            assertEq(
                Hashes.certificateIdHash(certificateId),
                vectors.readBytes32(string.concat(c, ".certificateIdHash")),
                string.concat("certificate id hash: ", name)
            );
            assertEq(
                registry.computeStatusKey(issuerDid, certificateId),
                vectors.readBytes32(string.concat(c, ".statusKey")),
                string.concat("status key: ", name)
            );
        }
        assertEq(count, 5, "every status key case was read");
    }

    function test_TheReasonCommitmentsAreTheKnownAnswers() public view {
        uint256 count;
        for (; vectors.keyExists(_at(".reasons", count)); count++) {
            string memory r = _at(".reasons", count);
            assertEq(
                governance.computeReasonHash(
                    vectors.readString(string.concat(r, ".code")),
                    vectors.readString(string.concat(r, ".note")),
                    vectors.readBytes32(string.concat(r, ".salt"))
                ),
                vectors.readBytes32(string.concat(r, ".reasonHash")),
                string.concat("reason: ", vectors.readString(string.concat(r, ".name")))
            );
        }
        assertEq(count, 4, "every reason case was read");
    }

    function test_AProposalOpenedWithAKnownReasonVerifiesOnChain() public {
        // The issuer commits to the reason and opens the proposal; an auditor,
        // given the disclosure, confirms it against the ledger.
        string memory r = _at(".reasons", 1);
        string memory code = vectors.readString(string.concat(r, ".code"));
        string memory note = vectors.readString(string.concat(r, ".note"));
        bytes32 salt = vectors.readBytes32(string.concat(r, ".salt"));

        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, vectors.readBytes32(string.concat(r, ".reasonHash")));
        assertTrue(governance.verifyProposalReason(1, code, note, salt));
    }

    function _at(string memory path, uint256 i) private pure returns (string memory) {
        return string.concat(path, "[", vm.toString(i), "]");
    }
}
