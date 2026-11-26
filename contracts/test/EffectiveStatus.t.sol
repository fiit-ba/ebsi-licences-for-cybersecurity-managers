pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {ITiConfiguration} from "../contracts/interfaces/ITiConfiguration.sol";

/// What a verifier acts on: valid only when VALID, its issuer accredited now,
/// and within its validity dates. `certificateStatus` stays the raw record.
contract EffectiveStatusTest is GovernanceTest {
    bytes32 internal constant DATED = keccak256("dated id");
    uint64 internal from;
    uint64 internal until;

    function setUp() public override {
        super.setUp();
        from = uint64(vm.getBlockTimestamp()) + DAY;
        until = from + 30 * DAY;
    }

    function test_AValidLicenceOfAnAccreditedTiIsValid() public view {
        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(CERTIFICATE);
        assertEq(uint8(status.record.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(status.record.issuerDid, TI_DID);
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.ACCREDITED));
        assertTrue(status.valid);
    }

    /// Audit: the loss of accreditation reads on chain; the raw record does
    /// not change.
    function test_ALicenceOfAWithdrawnTiIsNotValid() public {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(CERTIFICATE);
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.NOT_ACCREDITED));
        assertFalse(status.valid);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));

        issuers.accredit(TI_DID, keccak256("new"), IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, keccak256("new"));
        assertTrue(registry.effectiveStatus(CERTIFICATE).valid, "accredited again");
    }

    /// A TI whose TAO lost its accreditation is not accredited either.
    function test_ALicenceUnderARevokedTaoIsNotValid() public {
        issuers.accredit(taoDid, TAO_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, ROOT_DID, ROOT_ATTRIBUTE);
        assertEq(
            uint8(registry.effectiveStatus(CERTIFICATE).issuer), uint8(IGovernanceTypes.Accreditation.NOT_ACCREDITED)
        );
    }

    function test_ASuspendedOrRevokedLicenceIsNotValid() public {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(CERTIFICATE);
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.ACCREDITED));
        assertFalse(status.valid);

        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        skip(DAY);
        execute(id, A);
        assertFalse(registry.effectiveStatus(CERTIFICATE).valid);
    }

    /// Valid from `validFrom`, and until, not at, `validUntil`.
    function test_TheValidityDatesAreExact() public {
        bytes32 statusKey = _dated(until);
        vm.warp(from - 1);
        assertFalse(registry.effectiveStatus(statusKey).valid, "before");
        vm.warp(from);
        assertTrue(registry.effectiveStatus(statusKey).valid, "from");
        vm.warp(until - 1);
        assertTrue(registry.effectiveStatus(statusKey).valid, "a second before the end");
        vm.warp(until);
        assertFalse(registry.effectiveStatus(statusKey).valid, "at the end");
    }

    /// A `validUntil` of 0 never expires.
    function test_ALicenceWithoutAnEndStaysValid() public {
        bytes32 statusKey = _dated(0);
        vm.warp(from + 10 * 365 days);
        assertTrue(registry.effectiveStatus(statusKey).valid);
    }

    /// No record: UNKNOWN, not valid, and governance is not asked.
    function test_NoRecordIsUnknownAndNotValid() public {
        vm.mockCallRevert(address(governance), abi.encodeWithSelector(ITiConfiguration.isAccredited.selector), "");
        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(keccak256("nothing"));
        assertEq(uint8(status.record.standing), uint8(IGovernanceTypes.Standing.NONE));
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.UNKNOWN));
        assertFalse(status.valid);
    }

    /// When the check cannot be made: UNKNOWN, and not valid.
    function test_AFailedCheckIsUnknownAndNotValid() public {
        vm.mockCallRevert(address(governance), abi.encodeWithSelector(ITiConfiguration.isAccredited.selector), "down");
        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(CERTIFICATE);
        assertEq(uint8(status.record.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.UNKNOWN));
        assertFalse(status.valid);
    }

    /// The same rule as `isActiveTi`.
    function test_TheSameRuleAsIsActiveTi() public {
        assertEq(governance.isAccredited(TI_ID), governance.isActiveTi(TI_DID, TI_ATTRIBUTE));
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
        assertEq(governance.isAccredited(TI_ID), governance.isActiveTi(TI_DID, TI_ATTRIBUTE));
        assertFalse(governance.isAccredited(TI_ID));
    }

    function _dated(uint64 validUntil) private returns (bytes32 statusKey) {
        vm.prank(A);
        statusKey = registry.registerCertificate(
            DATED, TI_DID, from, validUntil, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID
        );
    }
}
