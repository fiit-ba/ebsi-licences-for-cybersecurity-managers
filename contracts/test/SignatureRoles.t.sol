pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/// A signature counts only in the role it was given in.
contract SignatureRolesTest is GovernanceTest {
    Role internal constant ROLE_D = Role.wrap(4);
    Role internal constant ROLE_E = Role.wrap(5);
    string internal constant COSIGNER = "did:ebsi:zCosignerD";
    address internal cosigner;

    function setUp() public override {
        super.setUp();
        cosigner = cosignerKey(COSIGNER);
        _nameCosigner(ROLE_D);
    }

    /// Audit: a removed TI key a cosigner's DID lists counted as the cosigner.
    function test_ARemovedKeysSignatureDoesNotComeBackAsACosigners() public {
        uint256 id = propose(B, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        applyAdmin(removeSigner(A, C, B));
        StubDidRegistry(didRegistry).setController(COSIGNER, B, true);
        assertEq(Role.unwrap(governance.roleOf(TI_ID, B)), Role.unwrap(ROLE_D), "B now resolves to D");

        assertEq(governance.getProposal(id).rolesSignedMask, NONE, "B's signature does not count as D");
        sign(id, A);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// Audit: a cosigner's signature followed the role the TAO gave it later.
    function test_ACosignersSignatureDoesNotFollowItsNewRole() public {
        uint256 id = propose(cosigner, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _nameCosigner(ROLE_E);

        assertEq(governance.getProposal(id).rolesSignedMask, NONE, "the D signature does not count as E");
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
    }

    /// Audit: a cosigner's signature counted as the TI role its key got later.
    function test_ACosignersSignatureDoesNotBecomeATiKeys() public {
        uint256 id = propose(cosigner, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        StubDidRegistry(didRegistry).setController(COSIGNER, cosigner, false);
        applyAdmin(addSigner(A, C, cosigner, ROLE_B));
        assertEq(Role.unwrap(governance.roleOf(TI_ID, cosigner)), Role.unwrap(ROLE_B));

        assertEq(governance.getProposal(id).rolesSignedMask, NONE, "the D signature does not count as B");
        sign(id, A);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
    }

    /// The same for a rule change's ballot.
    function test_ARuleChangesSignatureDoesNotFollowANewRole() public {
        vm.prank(cosigner);
        uint256 id = governance.proposeProposalTtl(TI_ID, pilotTtl + DAY);
        _nameCosigner(ROLE_E);
        assertEq(governance.getAdminProposal(id).rolesSignedMask, NONE, "the D signature does not count as E");
    }

    /// A signature keeps counting while its key keeps its role.
    function test_ASignatureCountsWhileItsKeyKeepsItsRole() public {
        uint256 id = propose(cosigner, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _nameCosigner(ROLE_D);
        assertEq(governance.getProposal(id).rolesSignedMask, only(ROLE_D), "still D");
        sign(id, A);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
    }

    /// A quorum lost when a role changes and regained by another restarts its timelock.
    function test_AQuorumRegainedAfterARoleChangeWaitsAgain() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, cosigner);
        _becomesATiKey(cosigner);
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);

        sign(id, B);
        assertEq(governance.getProposal(id).executableAt, vm.getBlockTimestamp() + DAY);
    }

    /// One signature per key: a dropped one is not given again in the new role.
    function test_RevertWhen_ADroppedSignerSignsAgain() public {
        uint256 id = propose(cosigner, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        _becomesATiKey(cosigner);
        vm.prank(cosigner);
        vm.expectRevert(IGovernanceTypes.AlreadySigned.selector);
        governance.signProposal(id);
    }

    /// The role is stored last; a signature from before has none and counts as now.
    function test_ASignatureFromBeforeTheUpgradeCountsAsItsKeysRole() public {
        uint256 id = propose(cosigner, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        // Ballot from slot 3: tiId, proposer.., quorumReachedAt.., signatures, signed, signedAs.
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("plr.storage.StatusProposals")) - 1)) & ~bytes32(uint256(0xff));
        uint256 proposal = uint256(keccak256(abi.encode(id, uint256(location) + 2)));
        bytes32 signed = keccak256(abi.encode(cosigner, proposal + 7));
        bytes32 signedAs = keccak256(abi.encode(cosigner, proposal + 8));
        assertEq(uint256(vm.load(address(governance), signed)), 1, "signed keeps its slot");
        assertEq(uint256(vm.load(address(governance), signedAs)), Role.unwrap(ROLE_D), "the role comes after it");

        vm.store(address(governance), signedAs, bytes32(0));
        _nameCosigner(ROLE_E);
        assertEq(governance.getProposal(id).rolesSignedMask, only(ROLE_E), "counts as its key's role now");
    }

    /// The cosigner's DID drops the key, and the TI makes it a key of role B.
    function _becomesATiKey(address key) private {
        StubDidRegistry(didRegistry).setController(COSIGNER, key, false);
        applyAdmin(addSigner(A, C, key, ROLE_B));
    }

    function _nameCosigner(Role role) private {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](1);
        list[0] = IGovernanceTypes.Cosigner(COSIGNER, role);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }
}
