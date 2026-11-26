pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";

/// A record starts VALID or SUSPENDED: a revocation always takes the revoke
/// policy, its quorum, its timelock and its veto.
contract InitialStandingTest is GovernanceTest {
    bytes32 internal constant NEW_ID = keccak256("new id");

    /// Audit: one key made an id revoked for good, with no quorum.
    function test_RevertWhen_ARecordIsBornRevoked() public {
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.InvalidStanding.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.REVOKED);

        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.VALID);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Neither REVOKED nor NONE, from any of the TI's keys.
    function test_RevertWhen_AnyKeyRegistersAnotherStanding() public {
        address[3] memory signers = [A, B, C];
        IGovernanceTypes.Standing[2] memory refused =
            [IGovernanceTypes.Standing.NONE, IGovernanceTypes.Standing.REVOKED];
        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = 0; j < refused.length; j++) {
                vm.prank(signers[i]);
                vm.expectRevert(IGovernanceTypes.InvalidStanding.selector);
                registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, refused[j]);
            }
        }
    }

    /// A value past the enum does not decode.
    function test_RevertWhen_TheStandingIsOutOfRange() public {
        bytes memory call = abi.encodeWithSelector(
            ICertificateRegistry.registerCertificate.selector, NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, uint8(4)
        );
        vm.prank(A);
        (bool ok,) = address(registry).call(call);
        assertFalse(ok);
    }

    /// The way for a licence revoked before its record: SUSPENDED, then a
    /// revocation through the quorum, which waits out its timelock.
    function test_ALicenceRevokedBeforeItsRecordIsRevokedByTheQuorum() public {
        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.SUSPENDED);
        uint256 id = propose(A, statusKey, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        uint64 executableAt = governance.getProposal(id).executableAt;
        assertEq(executableAt, vm.getBlockTimestamp() + DAY);
        vm.prank(A);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        governance.execute(id);

        vm.warp(executableAt);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// The veto stops that revocation; the licence stays suspended.
    function test_AVetoStopsTheRevocationOfALicenceRegisteredSuspended() public {
        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.SUSPENDED);
        uint256 id = propose(A, statusKey, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        cancel(id, C, REASON);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// A record registered SUSPENDED is not stuck: the quorum reinstates it,
    /// and a suspension at once has nothing to change.
    function test_ALicenceRegisteredSuspendedIsReinstatedByTheQuorum() public {
        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.SUSPENDED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        registry.suspendNow(statusKey, REASON_GIVEN);

        uint256 id = propose(A, statusKey, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        sign(id, B);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Documented: a TI key that learns an id first still takes it with a
    /// hash the TI never issued. At worst SUSPENDED now, never REVOKED: its
    /// fate stays with the quorum, and the TI reissues under a new id.
    function test_AnIdTakenFirstIsAtWorstSuspended() public {
        bytes32 forged = keccak256("forged");
        vm.prank(B);
        bytes32 statusKey =
            registry.registerCertificate(NEW_ID, TI_DID, 1, 0, forged, IGovernanceTypes.Standing.SUSPENDED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CertificateAlreadyRegistered.selector);
        registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
        assertEq(registry.certificateStatus(statusKey).credentialHash, forged);
    }

    /// The record and its event carry SUSPENDED from the start.
    function test_ARecordRegisteredSuspendedSaysSoFromTheStart() public {
        bytes32 statusKey = Hashes.statusKey(TI_DID, NEW_ID);
        vm.expectEmit(address(registry));
        emit ICertificateRegistry.CertificateRegistered(
            statusKey, CREDENTIAL_HASH, 1, 0, IGovernanceTypes.Standing.SUSPENDED, A
        );
        assertEq(_registerAs(IGovernanceTypes.Standing.SUSPENDED), statusKey);
        IGovernanceTypes.Certificate memory record = registry.certificateStatus(statusKey);
        assertEq(uint8(record.standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
        assertEq(record.registeredAt, vm.getBlockTimestamp());
        assertEq(record.changedAt, record.registeredAt);
    }

    /// A suspension has nothing to change on it, through the quorum either.
    function test_RevertWhen_ARecordRegisteredSuspendedIsProposedForSuspension() public {
        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.SUSPENDED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        governance.proposeAction(TI_ID, statusKey, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
    }

    /// A revocation that expires leaves it suspended, and is proposed again.
    function test_AnExpiredRevocationLeavesItSuspended() public {
        bytes32 statusKey = _registerAs(IGovernanceTypes.Standing.SUSPENDED);
        uint256 id = propose(A, statusKey, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        skip(pilotTtl);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));

        uint256 again = propose(A, statusKey, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(again, B);
        skip(DAY);
        execute(again, A);
        assertEq(uint8(registry.certificateStatus(statusKey).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    function _registerAs(IGovernanceTypes.Standing standing) private returns (bytes32 statusKey) {
        vm.prank(A);
        statusKey = registry.registerCertificate(NEW_ID, TI_DID, 1, 0, CREDENTIAL_HASH, standing);
    }
}
