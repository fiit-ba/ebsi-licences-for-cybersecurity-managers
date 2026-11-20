pragma solidity 0.8.26;

import {CertificateGovernance} from "../../contracts/CertificateGovernance.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {GovernanceTest} from "../GovernanceTest.sol";

/**
 * What the contract accepts, at its edges: any value either passes or is
 * refused with the error the rule names.
 */
contract ValidationFuzzTest is GovernanceTest {
    uint8 private constant PRESENT = 0x07; // A, B and C each hold a key

    function _popcount(uint8 bits) private pure returns (uint8 n) {
        for (; bits != 0; bits &= bits - 1) {
            n++;
        }
    }

    function _acceptable(uint8 threshold, uint8 required, uint8 veto, uint64 timelock) private view returns (bool) {
        return timelock <= governance.MAX_TIMELOCK() && threshold != 0 && _popcount(required) <= threshold
            && _popcount(PRESENT) >= threshold && PRESENT & required == required && PRESENT & veto != 0;
    }

    /// The pilot's proposals live 30 days: a timelock leaves the signing
    /// window within them.
    function _fitsTheLifetime(uint64 timelock) private view returns (bool) {
        return timelock + governance.MIN_SIGNING_WINDOW() <= pilotTtl;
    }

    // -----------------------------------------------------------------------
    // Policies and lifetime
    // -----------------------------------------------------------------------

    function testFuzz_ATiIsSetUpOnlyUnderAcceptablePolicies(
        uint8 kind,
        uint8 threshold,
        uint8 required,
        uint8 veto,
        uint64 timelock
    ) public {
        kind = uint8(bound(kind, 0, 3));
        // Mostly near the limits, where the rules are.
        timelock = uint64(bound(timelock, 0, 2 * governance.MAX_TIMELOCK()));
        IGovernanceTypes.Policy memory p = policy(threshold, RoleSet.wrap(required), RoleSet.wrap(veto), timelock);
        bool wellFormed = _acceptable(threshold, required, veto, timelock);
        bool acceptable = wellFormed && _fitsTheLifetime(timelock);
        // The policies first, then the lifetime against them.
        if (!wellFormed) vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        else if (!acceptable) vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        CertificateGovernance deployed = deploy(pilotWith(IGovernanceTypes.PolicyKind(kind), p));
        if (acceptable) {
            IGovernanceTypes.Policy memory stored = deployed.getPolicy(TI_ID, IGovernanceTypes.PolicyKind(kind));
            assertEq(stored.threshold, threshold, "threshold");
            assertEq(stored.timelock, timelock, "timelock");
        }
    }

    function testFuzz_APolicyChangeIsProposedOnlyIfAcceptable(
        uint8 kind,
        uint8 threshold,
        uint8 required,
        uint8 veto,
        uint64 timelock
    ) public {
        kind = uint8(bound(kind, 0, 3));
        timelock = uint64(bound(timelock, 0, 2 * governance.MAX_TIMELOCK()));
        if (!_acceptable(threshold, required, veto, timelock) || !_fitsTheLifetime(timelock)) {
            vm.expectRevert(IGovernanceTypes.InvalidPolicy.selector);
        }
        vm.prank(A);
        governance.proposePolicy(
            TI_ID, IGovernanceTypes.PolicyKind(kind), threshold, RoleSet.wrap(required), RoleSet.wrap(veto), timelock
        );
    }

    /// Bounded above, and below by the pilot's longest timelock (REVOKE's
    /// day) and the signing window.
    function testFuzz_AProposalLifetimeIsBounded(uint64 ttl) public {
        ttl = uint64(bound(ttl, 0, 2 * governance.MAX_PROPOSAL_TTL()));
        bool acceptable = ttl >= 1 days + governance.MIN_SIGNING_WINDOW() && ttl <= governance.MAX_PROPOSAL_TTL();
        if (!acceptable) vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        vm.prank(A);
        governance.proposeProposalTtl(TI_ID, ttl);
    }

    function testFuzz_ARoleIsOneToEight(uint8 role) public {
        bool acceptable = role >= 1 && role <= governance.MAX_ROLE();
        if (!acceptable) vm.expectRevert(IGovernanceTypes.InvalidRole.selector);
        vm.prank(A);
        governance.proposeAddSigner(TI_ID, spare, Role.wrap(role));
    }

    // -----------------------------------------------------------------------
    // Certificates
    // -----------------------------------------------------------------------

    function testFuzz_ACertificateIsValidFromBeforeUntil(uint64 validFrom, uint64 validUntil, string memory id) public {
        bytes32 idHash = Hashes.certificateIdHash(string.concat("urn:uuid:fuzz:", id));
        bool acceptable = validUntil == 0 || validUntil > validFrom;
        if (!acceptable) vm.expectRevert(IGovernanceTypes.InvalidValidity.selector);
        vm.prank(A);
        bytes32 key = registry.registerCertificate(
            idHash, TI_DID, validFrom, validUntil, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID
        );
        if (acceptable) {
            IGovernanceTypes.Certificate memory record = registry.certificateStatus(key);
            assertEq(key, Hashes.statusKey(TI_DID, idHash), "key");
            assertEq(record.validFrom, validFrom, "validFrom");
            assertEq(record.validUntil, validUntil, "validUntil");
            assertEq(uint8(record.standing), uint8(IGovernanceTypes.Standing.VALID), "standing");
        }
    }

    function testFuzz_ACertificateCanBeRegisteredOnlyOnce(uint8 standing, uint8 again) public {
        standing = uint8(bound(standing, 1, 3));
        again = uint8(bound(again, 1, 3));
        bytes32 idHash = Hashes.certificateIdHash("urn:uuid:fuzz:once");
        vm.prank(A);
        registry.registerCertificate(idHash, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing(standing));
        vm.expectRevert(IGovernanceTypes.CertificateAlreadyRegistered.selector);
        vm.prank(B);
        registry.registerCertificate(idHash, TI_DID, 1, 0, OTHER_CREDENTIAL_HASH, IGovernanceTypes.Standing(again));
    }

    // -----------------------------------------------------------------------
    // Who may act
    // -----------------------------------------------------------------------

    function testFuzz_NoKeyOutsideTheTiActs(address who) public {
        vm.assume(who != A && who != B && who != C && who != spare);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint256 change = addSigner(A, B, spare, ROLE_A); // applies at once: ADMIN has no timelock
        vm.prank(A);
        uint256 pending = governance.proposeProposalTtl(TI_ID, 7 days);
        // Ahead: sha256 is a call, and would take the expected revert.
        bytes32 idHash = Hashes.certificateIdHash("urn:uuid:fuzz:outsider");

        vm.startPrank(who);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.proposeAction(TI_ID, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.signProposal(id);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.execute(id);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelProposal(id, REASON);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.proposeRemoveSigner(TI_ID, A);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.signAdminProposal(pending);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.cancelAdminProposal(pending);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        registry.registerCertificate(idHash, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        registry.suspendNow(CERTIFICATE, REASON);
        vm.stopPrank();
        assertAdminState(change, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// The reason a proposal committed to is the one it verifies, and no other.
    function testFuzz_AProposalVerifiesOnlyItsReason(
        string memory code,
        string memory note,
        bytes32 salt,
        string memory otherNote
    ) public {
        vm.assume(keccak256(bytes(note)) != keccak256(bytes(otherNote)));
        bytes32 committed = governance.computeReasonHash(code, note, salt);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, committed);
        assertTrue(governance.verifyProposalReason(id, code, note, salt), "its reason");
        assertFalse(governance.verifyProposalReason(id, code, otherNote, salt), "another note");
        assertFalse(governance.verifyProposalReason(id, code, note, ~salt), "another salt");
    }
}
