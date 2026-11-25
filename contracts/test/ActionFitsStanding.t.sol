pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {GovernanceTest} from "./GovernanceTest.sol";
import {ICertificateRegistry} from "../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IStatusProposals} from "../contracts/interfaces/IStatusProposals.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";

/// An action is proposed and executed only if it changes the standing; a
/// proposal that no longer can blocks nothing.
contract ActionFitsStandingTest is GovernanceTest {
    using Hashes for string;

    IGovernanceTypes.ActionType internal constant SUSPEND = IGovernanceTypes.ActionType.SUSPEND;
    IGovernanceTypes.ActionType internal constant REVOKE = IGovernanceTypes.ActionType.REVOKE;
    IGovernanceTypes.ActionType internal constant REINSTATE = IGovernanceTypes.ActionType.REINSTATE;

    /// Audit: a reinstatement approved while the licence was valid undid a
    /// later emergency suspension. It can no longer be opened.
    function test_RevertWhen_AReinstatementIsProposedForAValidCertificate() public {
        vm.expectRevert(IGovernanceTypes.CertificateNotSuspended.selector);
        propose(A, CERTIFICATE, REINSTATE, NO_REASON);

        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        assertEq(governance.openProposalFor(CERTIFICATE), 0, "nothing waits to undo the suspension");
        assertEq(_standing(), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// Every action against every standing a TI can propose for.
    function test_EachActionOnlyWhereItChangesTheStanding() public {
        bytes32 valid = _record("urn:uuid:valid", IGovernanceTypes.Standing.VALID);
        bytes32 suspended = _record("urn:uuid:suspended", IGovernanceTypes.Standing.SUSPENDED);

        _accepted(valid, SUSPEND);
        _accepted(valid, REVOKE);
        _refused(valid, REINSTATE, IGovernanceTypes.CertificateNotSuspended.selector);

        _refused(suspended, SUSPEND, IGovernanceTypes.CertificateNotValid.selector);
        _accepted(suspended, REVOKE);
        _accepted(suspended, REINSTATE);
    }

    /// A suspension overtaken by `suspendNow` changes nothing: it reads as
    /// expired, takes no signature and is not executed.
    function test_ASuspensionOvertakenBySuspendNowExpires() public {
        uint256 id = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        vm.prank(B);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);

        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        assertEq(uint8(governance.getProposal(id).state), uint8(IGovernanceTypes.ProposalState.EXPIRED));
        vm.prank(B);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signProposal(id);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.cancelProposal(id, REASON);
    }

    /// Approved before `suspendNow`, the same: the quorum never decides twice.
    function test_AnApprovedSuspensionOvertakenBySuspendNowIsNotExecuted() public {
        uint256 id = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        sign(id, B);
        vm.prank(C);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
    }

    /// The next proposal expires the overtaken one instead of being blocked by it.
    function test_AnOvertakenProposalGivesWayToTheNext() public {
        uint256 overtaken = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);

        vm.expectEmit(address(governance));
        emit IStatusProposals.ProposalExpired(overtaken, CERTIFICATE);
        uint256 next = propose(A, CERTIFICATE, REINSTATE, NO_REASON);
        assertEq(governance.openProposalFor(CERTIFICATE), next);
        assertState(overtaken, IGovernanceTypes.ProposalState.EXPIRED);

        // Valid again, the old suspension would fit, but it stays expired.
        sign(next, B);
        execute(next, A);
        assertState(overtaken, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// Anyone may expire an overtaken proposal before its TTL; an open one that can
    /// still change the standing waits for its TTL.
    function test_AnyoneExpiresAnOvertakenProposalAtOnce() public {
        uint256 id = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        vm.prank(outsider);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);

        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.prank(outsider);
        governance.expireProposal(id);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.expireProposal(id);
    }

    /// Audit: an action that changed nothing still moved `changedAt` and
    /// emitted CertificateStandingChanged. Both now mark only real changes.
    function test_ChangedAtAndTheEventMarkOnlyRealChanges() public {
        uint256 id = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        sign(id, B);
        skip(HOUR);
        vm.prank(C);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 suspendedAt = vm.getBlockTimestamp();
        skip(HOUR);

        vm.recordLogs();
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        vm.prank(address(governance));
        vm.expectRevert(IGovernanceTypes.CertificateNotValid.selector);
        registry.applyExecuted(TI_ID, CERTIFICATE, SUSPEND, id, REASON_GIVEN, A);
        propose(A, CERTIFICATE, REINSTATE, NO_REASON);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertNotEq(logs[i].topics[0], ICertificateRegistry.CertificateStandingChanged.selector);
        }
        assertEq(registry.certificateStatus(CERTIFICATE).changedAt, suspendedAt);
    }

    /// A revocation still ends a certificate `suspendNow` suspended meanwhile.
    function test_ARevocationOutlivesASuspendNow() public {
        uint256 id = propose(A, CERTIFICATE, REVOKE, REASON_GIVEN);
        sign(id, B);
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        skip(DAY);
        execute(id, A);
        assertEq(_standing(), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// A reinstatement opened after the suspension, here in the same block.
    function test_AReinstatementAfterTheSuspensionLiftsIt() public {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 id = propose(A, CERTIFICATE, REINSTATE, NO_REASON);
        sign(id, B);
        execute(id, A);
        assertEq(_standing(), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// Executed and cancelled proposals keep their state whatever the standing does later.
    function test_DecidedProposalsKeepTheirState() public {
        uint256 suspension = propose(A, CERTIFICATE, SUSPEND, REASON_GIVEN);
        sign(suspension, B);
        execute(suspension, A);
        uint256 withdrawn = propose(A, CERTIFICATE, REVOKE, REASON_GIVEN);
        cancel(withdrawn, A, REASON);
        uint256 reinstatement = propose(A, CERTIFICATE, REINSTATE, NO_REASON);
        sign(reinstatement, B);
        execute(reinstatement, A);

        assertState(suspension, IGovernanceTypes.ProposalState.EXECUTED);
        assertState(withdrawn, IGovernanceTypes.ProposalState.CANCELLED);
        assertState(reinstatement, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// A reinstatement opened and approved on a valid certificate, as the
    /// version before this rule allowed, never lifts a suspension made later.
    function test_AReinstatementOpenedBeforeTheUpgradeNeverLiftsALaterSuspension() public {
        IGovernanceTypes.Certificate memory looksSuspended = registry.certificateStatus(CERTIFICATE);
        looksSuspended.standing = IGovernanceTypes.Standing.SUSPENDED;
        vm.mockCall(address(registry), abi.encodeWithSelector(ICertificateRegistry.requireChangeableBy.selector), "");
        vm.mockCall(
            address(registry),
            abi.encodeCall(ICertificateRegistry.certificateStatus, (CERTIFICATE)),
            abi.encode(looksSuspended)
        );
        uint256 id = propose(A, CERTIFICATE, REINSTATE, NO_REASON);
        sign(id, B);
        vm.clearMockedCalls();
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);

        skip(DAY);
        vm.prank(C);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.execute(id);
        assertEq(_standing(), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    // -----------------------------------------------------------------------

    function _accepted(bytes32 key, IGovernanceTypes.ActionType action) private {
        uint256 id = propose(A, key, action, REASON_GIVEN);
        cancel(id, A, REASON);
    }

    function _refused(bytes32 key, IGovernanceTypes.ActionType action, bytes4 error) private {
        vm.expectRevert(error);
        propose(A, key, action, REASON_GIVEN);
    }

    function _record(string memory id, IGovernanceTypes.Standing standing) private returns (bytes32) {
        bytes32 idHash = id.certificateIdHash();
        vm.prank(A);
        return registry.registerCertificate(idHash, TI_DID, 1, 0, CREDENTIAL_HASH, standing);
    }

    function _standing() private view returns (uint8) {
        return uint8(registry.certificateStatus(CERTIFICATE).standing);
    }
}
