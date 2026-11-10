// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";

/**
 * Each certificate on chain (DECISIONS.md D30, D36, D42): recorded with its id,
 * its TI, its credential's hash and its validity when it is issued, suspended
 * at once on one signature, and its standing set by every executed proposal. The only source
 * of truth a verifier reads, without the back-office.
 */
abstract contract CertificateStatusTest is GovernanceTest {
    string internal constant CERTIFICATE_ID = "urn:uuid:3f1a9c2b-7e4d-4056-a1b3-c5d7e9f02134";
    string internal constant ISSUER = TI_DID;
    string internal constant OTHER_ID = "urn:uuid:other";
    uint64 internal constant VALID_FROM = 1_767_225_600; // 2026-01-01
    uint64 internal constant VALID_UNTIL = 1_893_456_000; // 2030-01-01

    bytes32 internal KEY;
    bytes32 internal OTHER_KEY;

    // Computed ahead: sha256 is a call, and would take a pending prank.
    bytes32 internal ID_HASH;
    bytes32 internal OTHER_ID_HASH;

    function setUp() public virtual override {
        super.setUp();
        KEY = registry.computeStatusKey(ISSUER, CERTIFICATE_ID);
        OTHER_KEY = registry.computeStatusKey(ISSUER, OTHER_ID);
        ID_HASH = Hashes.certificateIdHash(CERTIFICATE_ID);
        OTHER_ID_HASH = Hashes.certificateIdHash(OTHER_ID);
    }

    // -----------------------------------------------------------------------
    // Registering, with every field overridable.
    // -----------------------------------------------------------------------

    function _register() internal returns (bytes32) {
        return _register(A, ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function _register(address by) internal returns (bytes32) {
        return _register(by, ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function _register(IGovernanceTypes.Standing standing) internal returns (bytes32) {
        return _register(A, ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, standing);
    }

    function _register(bytes32 id, string memory issuer, bytes32 credentialHash)
        internal
        returns (bytes32)
    {
        return _register(A, id, issuer, VALID_FROM, VALID_UNTIL, credentialHash, IGovernanceTypes.Standing.VALID);
    }

    function _register(
        address by,
        bytes32 id,
        string memory issuer,
        uint64 validFrom,
        uint64 validUntil,
        bytes32 credentialHash,
        IGovernanceTypes.Standing standing
    ) internal returns (bytes32 statusKey) {
        vm.prank(by);
        statusKey = registry.registerCertificate(id, issuer, validFrom, validUntil, credentialHash, standing);
    }

    function _standingOf(bytes32 key) internal view returns (IGovernanceTypes.Standing) {
        return registry.certificateStatus(key).standing;
    }

    /// Open a proposal for the certificate, sign it to quorum, past the
    /// timelock for a revocation. Does not execute: a caller does, so it can
    /// expect a revert.
    function _decide(IGovernanceTypes.ActionType action, bytes32 reasonHash) internal returns (uint256 id) {
        id = propose(A, KEY, action, reasonHash);
        sign(id, B);
        if (action == IGovernanceTypes.ActionType.REVOKE) skip(DAY);
    }
}

/// The status key.
contract StatusKeyTest is CertificateStatusTest {
    function test_IsSha256OverTheDomainTheTisDidAndTheIdsHash() public view {
        // Computed with `cast abi-encode` and SHA-256 outside the contract:
        // sha256(abi.encode("PLR-CERTIFICATE-V4", ISSUER, sha256(abi.encode("PLR-CERTIFICATE-ID-V1", CERTIFICATE_ID)))).
        assertEq(KEY, 0xfd0c951782210c33f59c32d8e12b0111951680ae5881b701dc4669ce69fc90eb);
        assertNotEq(registry.computeStatusKey(ISSUER, string.concat(CERTIFICATE_ID, " ")), KEY);
        assertNotEq(registry.computeStatusKey("did:ebsi:zOther", CERTIFICATE_ID), KEY);
    }

    function test_IsWhatRegisteringReturns() public {
        assertEq(_register(), KEY);
    }
}

/// Registering.
contract RegisteringTest is CertificateStatusTest {
    function test_RecordsTheCertificateItsValidityItsStandingAndItsCredentialHash() public {
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateRegistered(KEY, CREDENTIAL_HASH, VALID_FROM, VALID_UNTIL, IGovernanceTypes.Standing.VALID, A);
        _register();

        IGovernanceTypes.Certificate memory status = registry.certificateStatus(KEY);
        assertEq(uint8(status.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(status.issuerDid, ISSUER);
        assertEq(status.validFrom, VALID_FROM);
        assertEq(status.validUntil, VALID_UNTIL);
        assertEq(status.registeredAt, block.timestamp);
        assertEq(status.changedAt, block.timestamp);
        assertEq(status.credentialHash, CREDENTIAL_HASH);
    }

    function test_IsFoundByTheTiAndTheIdAlone() public {
        _register();
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(uint8(registry.certificateStatus(OTHER_KEY).standing), uint8(IGovernanceTypes.Standing.NONE));
    }

    function test_TakesOneSignatureOfAnyRole() public {
        _register(C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.VALID));
    }

    function test_RecordsACertificateSuspendedOrRevokedBeforeTheRecordExistedAsSuch() public {
        _register(IGovernanceTypes.Standing.SUSPENDED);
        _register(
            A, OTHER_ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, OTHER_CREDENTIAL_HASH, IGovernanceTypes.Standing.REVOKED
        );
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.SUSPENDED));
        assertEq(uint8(_standingOf(OTHER_KEY)), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    function test_AnswersNoneForACertificateItHasNoRecordOf() public view {
        IGovernanceTypes.Certificate memory status = registry.certificateStatus(KEY);
        assertEq(uint8(status.standing), uint8(IGovernanceTypes.Standing.NONE));
        assertEq(status.validUntil, 0);
        assertEq(status.credentialHash, bytes32(0));
    }

    function test_LeavesTheDatesToTheVerifier() public {
        vm.warp(1_000_000);
        uint64 soon = uint64(block.timestamp) + 60;
        _register(A, ID_HASH, ISSUER, soon - 120, soon, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        skip(120);
        IGovernanceTypes.Certificate memory status = registry.certificateStatus(KEY);
        assertEq(uint8(status.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(status.validUntil, soon);
    }

    function test_RecordsACertificateThatNeverExpires() public {
        _register(A, ID_HASH, ISSUER, VALID_FROM, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        assertEq(registry.certificateStatus(KEY).validUntil, 0);
    }

    function test_RevertWhen_TheCallerIsNotASigner() public {
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        _register(outsider);
    }

    function test_RevertWhen_NoId() public {
        vm.expectRevert(IGovernanceTypes.IncompleteCertificate.selector);
        _register(A, bytes32(0), ISSUER, VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_NoTi() public {
        vm.expectRevert(IGovernanceTypes.IncompleteCertificate.selector);
        _register(A, ID_HASH, "", VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_ExpiryBeforeItIsValid() public {
        vm.expectRevert(IGovernanceTypes.InvalidValidity.selector);
        _register(A, ID_HASH, ISSUER, VALID_FROM, VALID_FROM, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_NoCredentialHash() public {
        vm.expectRevert(IGovernanceTypes.IncompleteCertificate.selector);
        _register(A, ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, bytes32(0), IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_NoStanding() public {
        vm.expectRevert(IGovernanceTypes.InvalidStanding.selector);
        _register(A, ID_HASH, ISSUER, VALID_FROM, VALID_UNTIL, CREDENTIAL_HASH, IGovernanceTypes.Standing.NONE);
    }

    function test_RevertWhen_TheIdWasRecordedAlready() public {
        _register();
        vm.expectRevert(IGovernanceTypes.CertificateAlreadyRegistered.selector);
        _register(ID_HASH, ISSUER, OTHER_CREDENTIAL_HASH);
    }

    function test_ACopiedCredentialHashBlocksNoRecord() public {
        // The contract never sees the credential: only a verifier can tell
        // which of the two a JWT belongs to, by the id it carries.
        _register();
        _register(OTHER_ID_HASH, ISSUER, CREDENTIAL_HASH);
        assertEq(registry.certificateStatus(OTHER_KEY).credentialHash, CREDENTIAL_HASH);
    }

    function test_RecordsTheSameIdForAnotherTiApart() public {
        _register();
        accreditTi("did:ebsi:zOther");
        vm.prank(tao);
        governance.addTi(setup("did:ebsi:zOther", keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), pilotTtl));
        _register(ID_HASH, "did:ebsi:zOther", OTHER_CREDENTIAL_HASH);
        assertEq(uint8(_standingOf(registry.computeStatusKey("did:ebsi:zOther", CERTIFICATE_ID))), uint8(IGovernanceTypes.Standing.VALID));
    }
}

/// Suspending at once (component 10.6).
contract SuspendNowTest is CertificateStatusTest {
    function setUp() public override {
        super.setUp();
        _register();
    }

    function test_TakesOneSignatureAndAReason() public {
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateStandingChanged(KEY, IGovernanceTypes.Standing.SUSPENDED, 0, REASON_GIVEN, B);
        vm.prank(B);
        registry.suspendNow(KEY, REASON_GIVEN);

        IGovernanceTypes.Certificate memory status = registry.certificateStatus(KEY);
        assertEq(uint8(status.standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    function test_RevertWhen_NoReason() public {
        vm.expectRevert(IGovernanceTypes.ReasonRequired.selector);
        vm.prank(A);
        registry.suspendNow(KEY, NO_REASON);
    }

    function test_RevertWhen_TheCallerIsNotASigner() public {
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        vm.prank(outsider);
        registry.suspendNow(KEY, REASON_GIVEN);
    }

    function test_RevertWhen_TheCertificateIsUnknown() public {
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        vm.prank(A);
        registry.suspendNow(OTHER_KEY, REASON_GIVEN);
    }

    function test_RevertWhen_AlreadySuspended() public {
        vm.prank(A);
        registry.suspendNow(KEY, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        vm.prank(B);
        registry.suspendNow(KEY, REASON_GIVEN);
    }

    function test_IsUndoneByAReinstatementTheQuorumExecutes() public {
        vm.prank(A);
        registry.suspendNow(KEY, REASON_GIVEN);
        uint256 id = _decide(IGovernanceTypes.ActionType.REINSTATE, NO_REASON);
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateStandingChanged(KEY, IGovernanceTypes.Standing.VALID, id, NO_REASON, C);
        execute(id, C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.VALID));
    }
}

/// An executed proposal sets the standing.
contract ExecutedProposalSetsStandingTest is CertificateStatusTest {
    function setUp() public override {
        super.setUp();
        _register();
    }

    function test_ASuspensionMakesItSuspended() public {
        uint256 id = _decide(IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExecuted(id, KEY, IGovernanceTypes.ActionType.SUSPEND);
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateStandingChanged(KEY, IGovernanceTypes.Standing.SUSPENDED, id, REASON_GIVEN, C);
        execute(id, C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    function test_NothingChangesBeforeTheQuorum() public {
        propose(A, KEY, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.VALID));
    }

    function test_ARevocationMakesItRevokedForGood() public {
        execute(_decide(IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN), C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.REVOKED));

        IGovernanceTypes.ActionType[3] memory actions = [IGovernanceTypes.ActionType.SUSPEND, IGovernanceTypes.ActionType.REVOKE, IGovernanceTypes.ActionType.REINSTATE];
        for (uint256 i = 0; i < actions.length; i++) {
            vm.expectRevert(IGovernanceTypes.CertificateRevoked.selector);
            propose(A, KEY, actions[i], REASON_GIVEN);
        }
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        vm.prank(A);
        registry.suspendNow(KEY, REASON_GIVEN);
    }

    function test_ARevocationFollowsASuspensionAtOnce() public {
        vm.prank(A);
        registry.suspendNow(KEY, REASON_GIVEN);
        execute(_decide(IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN), C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    function test_AReinstatementThatReachesTheLedgerBeforeItsSuspensionLeavesItValid() public {
        // The back-office sends both; nothing orders them on the ledger.
        execute(_decide(IGovernanceTypes.ActionType.REINSTATE, NO_REASON), C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.VALID));
        execute(_decide(IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN), C);
        execute(_decide(IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN), C);
        assertEq(uint8(_standingOf(KEY)), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }
}

/// A certificate without a record.
contract CertificateWithoutRecordTest is CertificateStatusTest {
    function test_RevertWhen_ProposedFor() public {
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        propose(A, KEY, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    function test_RevertWhen_TheKeyIsZero() public {
        vm.expectRevert(IGovernanceTypes.UnknownCertificate.selector);
        propose(A, bytes32(0), IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }
}
