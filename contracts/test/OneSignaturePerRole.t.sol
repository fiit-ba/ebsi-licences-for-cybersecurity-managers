pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// A role signs a ballot once: a second key of a role that counts is refused,
/// so the list a signature, an execution and a view recount stays short.
contract OneSignaturePerRoleTest is GovernanceTest {
    Role internal constant ROLE_D = Role.wrap(4);
    string internal constant COSIGNER = "did:ebsi:zCosignerD";
    address internal cosigner;
    address internal secondKey;

    function setUp() public override {
        super.setUp();
        cosigner = cosignerKey(COSIGNER);
        secondKey = makeAddr("second key of the cosigner");
        // The cosigner DID's controller adds a key to its document.
        StubDidRegistry(didRegistry).setController(COSIGNER, secondKey, true);
        _nameCosigner();
    }

    /// Audit: every key a cosigner's DID listed could sign and be stored.
    function test_RevertWhen_ASecondCosignerKeySigns() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);
        assertEq(governance.getProposal(id).signatures.length, 2, "one entry per role");
    }

    /// The same for a rule change's ballot.
    function test_RevertWhen_ASecondCosignerKeySignsARuleChange() public {
        vm.prank(A);
        uint256 id = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        signAdmin(id, cosigner);
        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signAdminProposal(id);
        assertEq(governance.getAdminProposal(id).signatures.length, 2, "one entry per role");
    }

    /// The proposer's own role too: its signature is the ballot's first.
    function test_RevertWhen_AnotherKeyOfTheProposersRoleSigns() public {
        governance = deploy(keys(A, spare, C), roles(ROLE_A, ROLE_A, ROLE_C), pilotPolicies(), pilotTtl);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.prank(spare);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);
    }

    /// Once approved, a role that has not signed still may; one that has may not.
    function test_AnApprovedBallotTakesOnlyRolesNotYetCounted() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        sign(id, C);
        sign(id, cosigner);
        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);
        assertEq(governance.getProposal(id).signatures.length, 4, "every role once");
    }

    /// The same key again is still `AlreadySigned`: that check comes first.
    function test_RevertWhen_TheSameKeySignsAgain() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        vm.prank(cosigner);
        vm.expectRevert(IGovernanceTypes.AlreadySigned.selector);
        governance.signProposal(id);
    }

    /// A refused key is not marked: it signs once the first signature stops
    /// counting, and its signature brings the quorum back.
    function test_ASecondKeySignsOnceTheFirstSignatureStopsCounting() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, cosigner);
        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);

        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        sign(id, secondKey);
        assertEq(governance.getProposal(id).rolesSignedMask, both(ROLE_A, ROLE_D), "D counts again");
        execute(id, A);
    }

    /// The same for a TI key replaced after it signed.
    function test_AReplacementKeySignsOnceTheReplacedOnesSignatureStopsCounting() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        applyAdmin(replaceSigner(A, C, B, spare));
        assertEq(governance.getProposal(id).rolesSignedMask, only(ROLE_A), "B's signature stopped counting");

        sign(id, spare);
        assertEq(governance.getProposal(id).rolesSignedMask, both(ROLE_A, ROLE_B), "B counts again");
        skip(DAY);
        execute(id, A);
    }

    /// What is left: each further entry costs the controller a key it drops
    /// first, and the signatures of one role still count as one voice.
    function test_AKeyListedAgainCountsAsTheSameVoice() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        sign(id, secondKey);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, true);

        assertEq(governance.getProposal(id).signatures.length, 3);
        assertEq(governance.getProposal(id).rolesSignedMask, both(ROLE_A, ROLE_D), "D once");
        address third = makeAddr("third key of the cosigner");
        StubDidRegistry(didRegistry).setController(COSIGNER, third, true);
        vm.prank(third);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);
    }

    /// The same for a rule change: a second key signs once the first stops counting.
    function test_ASecondKeySignsARuleChangeOnceTheFirstStopsCounting() public {
        vm.prank(A);
        uint256 id = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        signAdmin(id, cosigner);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        assertEq(governance.getAdminProposal(id).rolesSignedMask, only(ROLE_A), "D stopped counting");

        signAdmin(id, secondKey);
        assertEq(governance.getAdminProposal(id).rolesSignedMask, both(ROLE_A, ROLE_D), "D counts again");
        applyAdmin(id);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// A signature from before roles were recorded counts as its key's role
    /// now, and so holds that role's place.
    function test_RevertWhen_AnotherKeySignsForARoleASignatureFromBeforeHolds() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        uint256 proposal = uint256(keccak256(abi.encode(id, uint256(location) + 2)));
        vm.store(address(governance), keccak256(abi.encode(cosigner, proposal + 8)), bytes32(0));
        assertEq(governance.getProposal(id).rolesSignedMask, both(ROLE_A, ROLE_D), "counts as D");

        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.RoleAlreadySigned.selector);
        governance.signProposal(id);
    }

    /// A ballot that is no longer open refuses with `ProposalNotOpen`, before
    /// any role is looked at.
    function test_RevertWhen_ASecondKeySignsAnExpiredBallot() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        skip(pilotTtl + DAY);
        vm.prank(secondKey);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.signProposal(id);
    }

    function _nameCosigner() private {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(COSIGNER, ROLE_D);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }
}
