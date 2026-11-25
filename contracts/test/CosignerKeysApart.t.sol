pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// No key is both a TI key and a key of one of its cosigners.
contract CosignerKeysApartTest is GovernanceTest {
    string internal constant SUPERVISOR = "did:ebsi:zSupervisor";
    string internal constant OTHER = "did:ebsi:zCosigner";
    address internal supervisor;

    function setUp() public override {
        super.setUp();
        supervisor = cosignerKey(SUPERVISOR);
        governance = deploy(keys(A, B), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl);
        vm.prank(tao);
        governance.setCosigners(TI_ID, _one(SUPERVISOR));
    }

    /// Audit: the TI listed the supervisor's key in its DID and made it a key of role B.
    function test_RevertWhen_TheTiMakesTheSupervisorsKeyOneOfItsOwn() public {
        assertTrue(_listedForTheTi(supervisor), "the TI's DID lists the supervisor's key");
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.proposeAddSigner(TI_ID, supervisor, ROLE_B);

        assertEq(Role.unwrap(governance.roleOf(TI_ID, supervisor)), Role.unwrap(ROLE_C));
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        cancel(id, supervisor, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function test_RevertWhen_TheTiReplacesAKeyWithTheSupervisors() public {
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.proposeReplaceSigner(TI_ID, B, supervisor);
    }

    function test_RevertWhen_AKeyApprovedBeforeTheSupervisorListedItApplies() public {
        uint256 id = addSigner(A, B, spare, ROLE_B);
        StubDidRegistry(didRegistry).setController(SUPERVISOR, spare, true);
        vm.warp(governance.getAdminProposal(id).executableAt);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        executeAdmin(id, A);
    }

    function test_RevertWhen_AReplacementApprovedBeforeTheTaoNamedItsCosignerApplies() public {
        uint256 id = replaceSigner(A, B, B, spare);
        StubDidRegistry(didRegistry).setController(OTHER, spare, true);
        vm.prank(tao);
        governance.setCosigners(TI_ID, _one(OTHER));
        vm.warp(governance.getAdminProposal(id).executableAt);
        // The cosigner change ends it before the key check could.
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        executeAdmin(id, A);
    }

    function test_RevertWhen_TheTaoNamesACosignerWhoseDidListsATiKey() public {
        StubDidRegistry(didRegistry).setController(OTHER, A, true);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.setCosigners(TI_ID, _one(OTHER));
    }

    /// A stored key counts even while the TI's DID does not list it.
    function test_RevertWhen_TheCosignersDidListsATiKeyTheDidRegistryDropped() public {
        StubDidRegistry(didRegistry).setController(TI_DID, A, false);
        StubDidRegistry(didRegistry).setController(TI_DID, B, true);
        StubDidRegistry(didRegistry).setController(OTHER, A, true);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.setCosigners(TI_ID, _one(OTHER));
    }

    function test_RevertWhen_ATiIsSetUpWithACosignerWhoseDidListsOneOfItsKeys() public {
        string memory did = "did:ebsi:zOtherTi";
        accreditTi(did);
        StubDidRegistry(didRegistry).setController(OTHER, B, true);
        IGovernanceTypes.TiSetup memory s = setup(did, keys(A, B), roles(ROLE_A, ROLE_B), pilot, pilotTtl);
        s.cosigners = _one(OTHER);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.addTi(s);
    }

    function test_RevertWhen_TheKeyIsTheSecondCosignersKey() public {
        StubDidRegistry(didRegistry).setController(OTHER, spare, true);
        vm.prank(tao);
        governance.setCosigners(TI_ID, _two(SUPERVISOR, OTHER));
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.proposeAddSigner(TI_ID, spare, ROLE_B);
    }

    function test_RevertWhen_TheSecondCosignerNamedListsATiKey() public {
        StubDidRegistry(didRegistry).setController(OTHER, B, true);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.CosignerSharesSignerKey.selector);
        governance.setCosigners(TI_ID, _two(SUPERVISOR, OTHER));
    }

    /// A key no cosigner's DID lists is added as before.
    function test_AKeyOfNoCosignerIsAdded() public {
        applyAdmin(addSigner(A, B, spare, ROLE_B));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, spare)), Role.unwrap(ROLE_B));
    }

    /// Documented: only the supervisor can list a TI key in its own DID, and
    /// that costs only it. The key keeps its TI role; the supervisor's own key still vetoes.
    function test_TheSupervisorListingATiKeyHarmsOnlyItself() public {
        StubDidRegistry(didRegistry).setController(SUPERVISOR, A, true);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, A)), Role.unwrap(ROLE_A));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, supervisor)), Role.unwrap(ROLE_C));
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        cancel(id, supervisor, REASON);
        assertState(id, IGovernanceTypes.ProposalState.CANCELLED);
    }

    function _one(string memory did) private pure returns (IGovernanceTypes.Cosigner[] memory list) {
        list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(did, ROLE_C);
    }

    /// Two cosigners of role C: one voice, below the pilot's threshold.
    function _two(string memory first, string memory second)
        private
        pure
        returns (IGovernanceTypes.Cosigner[] memory list)
    {
        list = new IGovernanceTypes.Cosigner[](2);
        list[0] = IGovernanceTypes.Cosigner(first, ROLE_C);
        list[1] = IGovernanceTypes.Cosigner(second, ROLE_C);
    }

    /// The stub lists every key under the TI's DID, as a TI could list the supervisor's.
    function _listedForTheTi(address key) private view returns (bool) {
        return StubDidRegistry(didRegistry).checkController(bytes(TI_DID), key);
    }
}
