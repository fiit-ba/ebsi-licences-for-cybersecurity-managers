pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
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
        assertEq(governance.getProposal(id).signatures[1], secondKey, "in the first key's place");
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
        assertEq(governance.getProposal(id).signatures.length, 2, "in B's place");
        skip(DAY);
        execute(id, A);
    }

    /// Audit: dropping each key after it signed let the next one add an entry.
    /// The next key takes the dropped one's place instead.
    function test_RotatingKeysKeepsOneEntryPerRole() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        StubDidRegistry(didRegistry).setController(COSIGNER, secondKey, false);
        address key = cosigner;
        for (uint256 i = 0; i < 20; i++) {
            if (i > 0) {
                StubDidRegistry(didRegistry).setController(COSIGNER, key, false);
                key = address(uint160(0x10000 + i));
                StubDidRegistry(didRegistry).setController(COSIGNER, key, true);
            }
            sign(id, key);
        }
        address[] memory signatures = governance.getProposal(id).signatures;
        assertEq(signatures.length, 2, "one entry per role");
        assertEq(signatures[1], key, "the latest key");
        assertEq(governance.getProposal(id).rolesSignedMask, both(ROLE_A, ROLE_D), "A and D");
    }

    /// A signature taken over does not come back: its key listed again
    /// counts for nothing, and cannot sign again either.
    function test_ASignatureTakenOverDoesNotComeBack() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        sign(id, secondKey);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, true);
        StubDidRegistry(didRegistry).setController(COSIGNER, secondKey, false);

        assertEq(governance.getProposal(id).signatures.length, 2);
        assertEq(governance.getProposal(id).rolesSignedMask, only(ROLE_A), "the first key's signature is gone");
        vm.prank(cosigner);
        vm.expectRevert(IGovernanceTypes.AlreadySigned.selector);
        governance.signProposal(id);
    }

    /// Only an entry of the signer's own role is taken over: another role's
    /// lapsed entry stays, and counts again when its key is listed again.
    function test_AnotherRolesLapsedEntryStays() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        _listForTheTi(B, false);
        sign(id, cosigner);
        address[] memory signatures = governance.getProposal(id).signatures;
        assertEq(signatures.length, 3, "appended");
        assertEq(signatures[1], B, "B's entry stays");
        _listForTheTi(B, true);
        assertEq(uint8(RoleSet.unwrap(governance.getProposal(id).rolesSignedMask)), 0x0b, "A, B and D");
    }

    /// A signature from before roles were recorded holds no role's place: a
    /// key signing after it lapsed is appended.
    function test_ASignatureFromBeforeIsNotTakenOver() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        vm.store(address(governance), keccak256(abi.encode(cosigner, _proposalSlot(id) + 8)), bytes32(0));
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        sign(id, secondKey);
        assertEq(governance.getProposal(id).signatures.length, 3);
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
        assertEq(governance.getAdminProposal(id).signatures.length, 2, "in the first key's place");
        applyAdmin(id);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// A signature from before roles were recorded counts as its key's role
    /// now, and so holds that role's place.
    function test_RevertWhen_AnotherKeySignsForARoleASignatureFromBeforeHolds() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        vm.store(address(governance), keccak256(abi.encode(cosigner, _proposalSlot(id) + 8)), bytes32(0));
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

    function _listForTheTi(address key, bool listed) private {
        StubDidRegistry(didRegistry).setController(TI_DID, A, true);
        StubDidRegistry(didRegistry).setController(TI_DID, C, true);
        StubDidRegistry(didRegistry).setController(TI_DID, key, listed);
    }

    function _proposalSlot(uint256 id) private pure returns (uint256) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        return uint256(keccak256(abi.encode(id, uint256(location) + 2)));
    }

    function _nameCosigner() private {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(COSIGNER, ROLE_D);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }
}
