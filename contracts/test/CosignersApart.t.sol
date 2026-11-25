pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {ITiConfiguration} from "../contracts/interfaces/ITiConfiguration.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// No cosigner holds a TI key's role, and cosigners alone meet no threshold.
contract CosignersApartTest is GovernanceTest {
    Role internal constant ROLE_D = Role.wrap(4);
    Role internal constant ROLE_E = Role.wrap(5);
    string internal constant OTHER_TI = "did:ebsi:zOtherTi";

    /// Audit: the TAO met a TI's quorum with two DIDs of its own.
    function test_RevertWhen_TheTaoGivesItsOwnDidsTheTisRoles() public {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](2);
        list[0] = IGovernanceTypes.Cosigner(taoDid, ROLE_A);
        list[1] = IGovernanceTypes.Cosigner("did:ebsi:zTaoSecond", ROLE_B);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        governance.setCosigners(TI_ID, list);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, tao)), 0);
    }

    function test_RevertWhen_TheCosignersAloneWouldMeetAThreshold() public {
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        governance.setCosigners(TI_ID, _cosigners(ROLE_D, ROLE_E));
    }

    function test_TheCosignersStayOneRoleShortOfTheLowestThreshold() public {
        IGovernanceTypes.Policy[4] memory policies = pilotPolicies();
        for (uint256 i = 0; i < 4; i++) {
            policies[i].threshold = 3;
        }
        governance = deploy(policies);
        vm.startPrank(tao);
        governance.setCosigners(TI_ID, _cosigners(ROLE_D, ROLE_E));
        IGovernanceTypes.Cosigner[] memory three = new IGovernanceTypes.Cosigner[](3);
        (three[0], three[1]) = (_cosigners(ROLE_D, ROLE_E)[0], _cosigners(ROLE_D, ROLE_E)[1]);
        three[2] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerF", Role.wrap(6));
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        governance.setCosigners(TI_ID, three);
        vm.stopPrank();
    }

    function test_TwoCosignersOfOneRoleAreOneVoice() public {
        IGovernanceTypes.Cosigner[] memory list = _cosigners(ROLE_D, ROLE_D);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.CosignersChanged(TI_ID, list);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        assertEq(governance.getTi(TI_ID).cosigners.length, 2);
    }

    function test_ASupervisoryCosignerInARoleOfItsOwnIsAllowed() public {
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", ROLE_C);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, makeAddr("a supervisor key"))), Role.unwrap(ROLE_C));
    }

    function test_RevertWhen_TheTaoTakesTheRoleOfAKeyTheDidRegistryDropped() public {
        StubDidRegistry(didRegistry).setController(TI_DID, A, false);
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, A)), 0, "A's key no longer signs");
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        governance.setCosigners(TI_ID, _oneCosigner(ROLE_A));
    }

    function test_CosignersSwappedDuringABallotDoNotAddUp() public {
        address first = makeAddr("first cosigner's key");
        address second = makeAddr("second cosigner's key");
        StubDidRegistry(didRegistry).setController("did:ebsi:zCosignerD", first, true);
        StubDidRegistry(didRegistry).setController("did:ebsi:zCosignerE", second, true);
        _cosign(ROLE_D);
        uint256 id = propose(first, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);

        IGovernanceTypes.Cosigner[] memory next = new IGovernanceTypes.Cosigner[](1);
        next[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerE", ROLE_E);
        vm.prank(tao);
        governance.setCosigners(TI_ID, next);
        sign(id, second);

        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        assertEq(governance.getProposal(id).rolesSignedMask, only(ROLE_E), "only the standing cosigner counts");
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(id, second);

        sign(id, A);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }

    // -----------------------------------------------------------------------
    // Setting a TI up
    // -----------------------------------------------------------------------

    function test_SettingUpATiAnnouncesItsCosigners() public {
        IGovernanceTypes.TiSetup memory s = _otherTi();
        s.cosigners = _oneCosigner(ROLE_D);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.CosignersChanged(keccak256(bytes(OTHER_TI)), s.cosigners);
        vm.prank(tao);
        governance.addTi(s);
    }

    /// pilot.json and production.json: keys A and B, NBÚ as cosigner C.
    function test_TheShippedRulesSetUpATiSupervisedByACosigner() public {
        string[2] memory files = ["config/pilot.json", "config/production.json"];
        for (uint256 i = 0; i < files.length; i++) {
            (IGovernanceTypes.Policy[4] memory policies, uint64 ttl) = _readConfig(files[i]);
            string memory did = string.concat("did:ebsi:zShipped", vm.toString(i));
            accreditTi(did);
            IGovernanceTypes.TiSetup memory s = setup(did, keys(A, B), roles(ROLE_A, ROLE_B), policies, ttl);
            s.cosigners = new IGovernanceTypes.Cosigner[](1);
            s.cosigners[0] = IGovernanceTypes.Cosigner("did:ebsi:zSupervisor", ROLE_C);
            vm.prank(tao);
            governance.addTi(s);
        }
    }

    function test_RevertWhen_ATiIsSetUpWithACosignerInOneOfItsKeysRoles() public {
        IGovernanceTypes.TiSetup memory s = _otherTi();
        s.cosigners = new IGovernanceTypes.Cosigner[](1);
        s.cosigners[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosigner", ROLE_B);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        governance.addTi(s);
    }

    function test_RevertWhen_ATiIsSetUpWithCosignersThatMeetAThreshold() public {
        IGovernanceTypes.TiSetup memory s = _otherTi();
        s.cosigners = _cosigners(ROLE_D, ROLE_E);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        governance.addTi(s);
    }

    // -----------------------------------------------------------------------
    // The TI's own rule changes, at proposal and again at execution
    // -----------------------------------------------------------------------

    function test_RevertWhen_TheTiAddsAKeyInACosignersRole() public {
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        _cosign(ROLE_C);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        governance.proposeAddSigner(TI_ID, spare, ROLE_C);
    }

    function test_RevertWhen_TheTiLowersAThresholdTheCosignersWouldMeet() public {
        _cosign(ROLE_D);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        governance.proposePolicy(TI_ID, IGovernanceTypes.PolicyKind.SUSPEND, 1, NONE, ALL, 0);
    }

    function test_RevertWhen_AKeyApprovedBeforeACosignerOfItsRoleApplies() public {
        uint256 id = addSigner(A, B, spare, ROLE_D);
        _cosign(ROLE_D);
        vm.warp(governance.getAdminProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.CosignerHoldsSignerRole.selector);
        executeAdmin(id, A);
    }

    function test_RevertWhen_AThresholdApprovedBeforeACosignerIsNamedApplies() public {
        uint256 id = setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(1, NONE, ALL, 0));
        _cosign(ROLE_D);
        vm.warp(governance.getAdminProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        executeAdmin(id, A);
    }

    function test_AThresholdOfOneStaysOpenToATiWithoutCosigners() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(1, NONE, ALL, 0)));
        assertEq(governance.getPolicy(TI_ID, IGovernanceTypes.PolicyKind.SUSPEND).threshold, 1);
    }

    function test_RevertWhen_TheTaoNamesACosignerAfterTheTiDecidesOnOneSignature() public {
        applyAdmin(setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(1, NONE, ALL, 0)));
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignersMeetAQuorum.selector);
        governance.setCosigners(TI_ID, _oneCosigner(ROLE_D));
    }

    // -----------------------------------------------------------------------

    function _cosign(Role role) private {
        vm.prank(tao);
        governance.setCosigners(TI_ID, _oneCosigner(role));
    }

    function _oneCosigner(Role role) private pure returns (IGovernanceTypes.Cosigner[] memory list) {
        list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerD", role);
    }

    function _cosigners(Role first, Role second) private pure returns (IGovernanceTypes.Cosigner[] memory list) {
        list = new IGovernanceTypes.Cosigner[](2);
        list[0] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerD", first);
        list[1] = IGovernanceTypes.Cosigner("did:ebsi:zCosignerE", second);
    }

    /// A second TI of the TAO, accredited, with keys A, B and C.
    function _otherTi() private returns (IGovernanceTypes.TiSetup memory) {
        accreditTi(OTHER_TI);
        return setup(OTHER_TI, keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), pilot, pilotTtl);
    }
}
