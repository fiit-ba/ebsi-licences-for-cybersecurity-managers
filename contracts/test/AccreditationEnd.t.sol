pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {ITiConfiguration} from "../contracts/interfaces/ITiConfiguration.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";

/// A TI past its `accreditedUntil` is not accredited: it lowers trust and
/// never raises it, as after a withdrawal in the TIR.
contract AccreditationEndTest is GovernanceTest {
    bytes32 internal constant NEW_ATTRIBUTE = keccak256("new ti attribute");
    uint64 internal end;

    function setUp() public override {
        super.setUp();
        end = uint64(vm.getBlockTimestamp()) + 10 * DAY;
        _renew(end);
    }

    /// Audit: past the end the TI registered, reinstated and changed its rules.
    function test_AnExpiredTiLowersTrustButNeverRaisesIt() public {
        vm.warp(end);
        assertFalse(governance.isAccredited(TI_ID));
        assertTrue(governance.isActiveTi(TI_DID, TI_ATTRIBUTE), "the TIR alone still says yes");

        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        registry.registerCertificate(keccak256("late"), TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);

        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(TI_ID, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        skip(DAY);
        execute(id, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.REVOKED));

        IGovernanceTypes.EffectiveStatus memory status = registry.effectiveStatus(OTHER_CERTIFICATE);
        assertEq(uint8(status.record.standing), uint8(IGovernanceTypes.Standing.VALID));
        assertEq(uint8(status.issuer), uint8(IGovernanceTypes.Accreditation.NOT_ACCREDITED));
        assertFalse(status.valid);
    }

    /// Accredited until, not at, the end.
    function test_TheEndIsExact() public {
        vm.warp(end - 1);
        assertTrue(governance.isAccredited(TI_ID));
        assertTrue(registry.effectiveStatus(OTHER_CERTIFICATE).valid);
        vm.prank(A);
        registry.registerCertificate(keccak256("last"), TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);

        vm.warp(end);
        assertFalse(governance.isAccredited(TI_ID));
        assertFalse(registry.effectiveStatus(OTHER_CERTIFICATE).valid);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        registry.registerCertificate(keccak256("late"), TI_DID, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    /// Any end, any time: accredited exactly while the time is before it.
    function testFuzz_AccreditedOnlyBeforeTheEnd(uint64 until, uint64 at) public {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        until = uint64(bound(until, now_ + 1, type(uint64).max));
        _renew(until);
        at = uint64(bound(at, now_, type(uint64).max));
        vm.warp(at);
        assertEq(governance.isAccredited(TI_ID), at < until);
        assertEq(registry.effectiveStatus(OTHER_CERTIFICATE).valid, at < until);
    }

    /// Neither a setup nor a renewal takes an end that has come, 0 included.
    function test_RevertWhen_TheEndIsZeroOrPast() public {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        vm.startPrank(tao);
        vm.expectRevert(IGovernanceTypes.InvalidAccreditedUntil.selector);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE, 0);
        vm.expectRevert(IGovernanceTypes.InvalidAccreditedUntil.selector);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE, now_);

        string memory other = "did:ebsi:zOtherTi";
        accreditTi(other);
        IGovernanceTypes.TiSetup memory s = setup(other, keys(spare, outsider), roles(ROLE_A, ROLE_B), pilot, pilotTtl);
        s.accreditedUntil = 0;
        vm.expectRevert(IGovernanceTypes.InvalidAccreditedUntil.selector);
        governance.addTi(s);
        s.accreditedUntil = now_;
        vm.expectRevert(IGovernanceTypes.InvalidAccreditedUntil.selector);
        governance.addTi(s);

        s.accreditedUntil = now_ + 1;
        vm.expectEmit(address(governance));
        emit ITiConfiguration.TiConfigured(keccak256(bytes(other)), other, TI_ATTRIBUTE, now_ + 1);
        bytes32 otherId = governance.addTi(s);
        vm.stopPrank();
        assertEq(governance.getTi(otherId).accreditedUntil, now_ + 1);
        assertTrue(governance.isAccredited(otherId));
        skip(1);
        assertFalse(governance.isAccredited(otherId));
    }

    /// A renewal before the end moves it and ends nothing.
    function test_ARenewalBeforeTheEndEndsNothing() public {
        uint256 reinstatement = _openReinstatement();
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);

        vm.expectEmit(address(governance));
        emit ITiConfiguration.TiAttributeChanged(TI_ID, TI_ATTRIBUTE, end + 365 days);
        _renew(end + 365 days);
        assertEq(governance.getTi(TI_ID).accreditedUntil, end + 365 days);

        vm.warp(end);
        assertTrue(governance.isAccredited(TI_ID));
        assertAdminState(rule, IGovernanceTypes.ProposalState.PROPOSED);
        sign(reinstatement, B);
        execute(reinstatement, A);
        assertEq(uint8(registry.certificateStatus(CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.VALID));
    }

    /// A renewal after the end restores the TI: what raises trust or changes
    /// its rules, opened before, is decided again; a revocation goes on.
    function test_ARenewalAfterTheEndEndsReinstatementsAndRuleChanges() public {
        uint256 reinstatement = _openReinstatement();
        vm.prank(A);
        uint256 rule = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        uint256 revocation = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);

        vm.warp(end);
        assertState(reinstatement, IGovernanceTypes.ProposalState.PROPOSED);
        _renew(end + 365 days);
        assertState(reinstatement, IGovernanceTypes.ProposalState.EXPIRED);
        assertAdminState(rule, IGovernanceTypes.ProposalState.EXPIRED);
        assertState(revocation, IGovernanceTypes.ProposalState.PROPOSED);
        assertEq(_slot(10), 1, "one restoration");

        _renew(end + 400 days);
        assertEq(_slot(10), 1, "a renewal of a live TI restores nothing");
    }

    /// A renewal a second before the end restores nothing; one at the end does.
    function test_ARenewalAtTheEndIsARestoration() public {
        vm.warp(end - 1);
        _renew(end + DAY);
        assertEq(_slot(10), 0, "a second before");
        vm.warp(end + DAY);
        _renew(end + 2 * DAY);
        assertEq(_slot(10), 1, "at the end");
    }

    /// A refused renewal after the end ends nothing and restores nothing.
    function test_ARefusedRenewalEndsNothing() public {
        uint256 reinstatement = _openReinstatement();
        vm.warp(end);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.InvalidAccreditedUntil.selector);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE, end);
        _withdrawInTheTir();
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE, end + 365 days);

        assertState(reinstatement, IGovernanceTypes.ProposalState.PROPOSED);
        assertEq(_slot(10), 0);
        assertEq(governance.getTi(TI_ID).accreditedUntil, end);
        assertFalse(governance.isAccredited(TI_ID));
    }

    /// Past the end and withdrawn in the TIR: a new attribute is one restoration.
    function test_ANewAttributeAfterBothLossesIsOneRestoration() public {
        uint256 reinstatement = _openReinstatement();
        vm.warp(end);
        _withdrawInTheTir();
        issuers.accredit(TI_DID, NEW_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE, end + 365 days);
        assertEq(_slot(10), 1);
        assertTrue(governance.isAccredited(TI_ID));
        assertState(reinstatement, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// What raises trust and was approved before the end does not execute
    /// after it; a suspension does.
    function test_RevertWhen_WhatRaisesTrustExecutesAfterTheEnd() public {
        uint256 reinstatement = _openReinstatement();
        sign(reinstatement, B);
        uint256 rule = setTtl(A, B, pilotTtl + DAY);
        uint256 suspension = propose(A, OTHER_CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(suspension, B);

        vm.warp(end);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.execute(reinstatement);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.executeAdminProposal(rule);
        execute(suspension, A);
        assertEq(
            uint8(registry.certificateStatus(OTHER_CERTIFICATE).standing), uint8(IGovernanceTypes.Standing.SUSPENDED)
        );
    }

    /// The TAO may bring the end closer; that restores nothing either.
    function test_TheTaoMayBringTheEndCloser() public {
        _renew(uint64(vm.getBlockTimestamp()) + DAY);
        assertEq(_slot(10), 0);
        skip(DAY);
        assertFalse(governance.isAccredited(TI_ID));
    }

    /// A TI set up before the date existed has none, until the TAO sets one;
    /// setting it restores nothing.
    function test_ATiWithoutAnEndHasNoneUntilTheTaoSetsOne() public {
        vm.store(address(governance), bytes32(_tiSlot() + 8), bytes32(_slot(8) & type(uint192).max));
        assertEq(governance.getTi(TI_ID).accreditedUntil, 0);
        vm.warp(end + 3650 days);
        assertTrue(governance.isAccredited(TI_ID));

        _renew(end + 3651 days);
        assertEq(_slot(10), 0);
        vm.warp(end + 3651 days);
        assertFalse(governance.isAccredited(TI_ID));
    }

    /// A TI without an end, withdrawn in the TIR, is restored by its first date.
    function test_ATiWithoutAnEndWithdrawnInTheTirIsRestored() public {
        vm.store(address(governance), bytes32(_tiSlot() + 8), bytes32(_slot(8) & type(uint192).max));
        _withdrawInTheTir();
        assertFalse(governance.isAccredited(TI_ID));
        issuers.accredit(TI_DID, NEW_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE, end);
        assertEq(_slot(10), 1);
        assertEq(governance.getTi(TI_ID).accreditedUntil, end);
    }

    /// The end takes the free bytes of the epoch's slot.
    function test_TheEndTakesBytesThatWereFree() public view {
        uint256 slot = _slot(8);
        assertEq(uint64(slot), pilotTtl, "proposalTtl");
        assertEq(uint64(slot >> 64), governance.getTi(TI_ID).version, "version");
        assertEq(uint64(slot >> 128), 0, "epoch");
        assertEq(uint64(slot >> 192), end, "accreditedUntil");
    }

    function _renew(uint64 until) internal {
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, TI_ATTRIBUTE, until);
    }

    function _withdrawInTheTir() internal {
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.Revoked, taoDid, TAO_ATTRIBUTE);
    }

    function _openReinstatement() internal returns (uint256) {
        vm.prank(A);
        registry.suspendNow(CERTIFICATE, REASON_GIVEN);
        return propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REINSTATE, REASON_GIVEN);
    }

    function _tiSlot() internal pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.TiConfiguration")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(TI_ID, location)));
    }

    function _slot(uint256 offset) internal view returns (uint256) {
        return uint256(vm.load(address(governance), bytes32(_tiSlot() + offset)));
    }
}
