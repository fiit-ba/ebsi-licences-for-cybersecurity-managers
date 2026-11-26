pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {Role} from "../contracts/libraries/Roles.sol";

/// A TI that lost its accreditation lowers trust through its quorum, and
/// never raises it.
contract AccreditationLostTest is GovernanceTest {
    bytes32 internal constant NEW_ATTRIBUTE = keccak256("new ti attribute");
    bytes32 internal constant THIRD_ATTRIBUTE = keccak256("third ti attribute");

    /// Audit: after a withdrawal, the licence was suspended and its revocation
    /// case could neither be opened nor executed.
    function test_AWithdrawnTiRevokesItsLicencesThroughItsQuorum() public {
        _revokeTheTi();
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        vm.prank(A);
        vm.expectRevert(
            abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, vm.getBlockTimestamp() + DAY)
        );
        governance.execute(id);
        skip(DAY);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));

        _accreditAgain(NEW_ATTRIBUTE);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// The veto holds over it.
    function test_TheVetoStopsARevocationWithoutAccreditation() public {
        _revokeTheTi();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        cancel(id, C, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    /// A suspension approved before the loss executes during it.
    function test_ASuspensionApprovedBeforeExecutesDuringTheLoss() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, B);
        _revokeTheTi();
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    /// A revocation opened during the loss goes on after the return: the
    /// return ends only what raises trust or changes rules.
    function test_ARevocationOpenedDuringTheLossGoesOnAfterTheReturn() public {
        _revokeTheTi();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        _accreditAgain(NEW_ATTRIBUTE);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        sign(id, B);
        skip(DAY);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));
    }

    /// Each return counts: a reinstatement opened between two ends with the
    /// second; one opened after the last runs.
    function test_EachReturnEndsTheReinstatementsOpenedBefore() public {
        _revokeTheTi();
        _accreditAgain(NEW_ATTRIBUTE);
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        uint256 between = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        issuers.accredit(TI_DID, NEW_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        _accreditAgain(THIRD_ATTRIBUTE);
        assertState(between, IGovernanceTypes.ProposalState.EXPIRED);

        uint256 after_ = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        sign(after_, B);
        execute(after_, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// A cosigner change still ends everything, a revocation opened during the
    /// loss included.
    function test_ACosignerChangeStillEndsARevocationOpenedDuringTheLoss() public {
        _revokeTheTi();
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerD", Role.wrap(4));
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// Unknown TIs stay unknown.
    function test_RevertWhen_TheTiIsUnknown() public {
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.NotAnOwnSigner.selector);
        governance.proposeAction(
            keccak256("no such ti"), CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN
        );
        vm.expectRevert(IGovernanceTypes.UnknownTi.selector);
        governance.isAccredited(keccak256("no such ti"));
    }

    /// The counters fill free bytes: the ballot's beside its epoch, the TI's
    /// a new slot after the loosening times; nothing moves.
    function test_TheRestorationsTakeBytesThatWereFree() public {
        uint256 ti = uint256(keccak256(abi.encode(TI_ID, _location("plr.storage.TiConfiguration"))));
        bytes32 before8 = vm.load(address(governance), bytes32(ti + 8));
        _revokeTheTi();
        _accreditAgain(NEW_ATTRIBUTE);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);

        assertEq(uint32(uint256(vm.load(address(governance), bytes32(ti + 10)))), 1, "TI restorations");
        assertEq(uint64(uint256(vm.load(address(governance), bytes32(ti + 8))) >> 128), uint64(uint256(before8) >> 128));
        assertEq(uint256(vm.load(address(governance), bytes32(ti + 11))), 0, "nothing after");
        uint256 proposal = uint256(keccak256(abi.encode(id, uint256(_location("plr.storage.StatusProposals")) + 2)));
        uint256 slot = uint256(vm.load(address(governance), bytes32(proposal + 5)));
        assertEq(uint32(slot >> 200), 1, "ballot restorations");
        assertEq(uint64(slot >> 72), governance.getProposal(id).expiresAt, "expiresAt stays");
    }

    function _location(string memory id) private pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function _revokeTheTi() internal {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        assertFalse(governance.isAccredited(TI_ID));
    }

    function _accreditAgain(bytes32 attribute) internal {
        issuers.accredit(TI_DID, attribute, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, attribute);
        assertTrue(governance.isAccredited(TI_ID));
    }
}
