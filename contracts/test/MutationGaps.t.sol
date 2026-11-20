pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {IRuleChanges} from "../contracts/interfaces/IRuleChanges.sol";
import {ITiConfiguration} from "../contracts/interfaces/ITiConfiguration.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";

/**
 * What the mutation campaign of 20 November 2026 found no test for: each test
 * here fails on a change to the contracts that every other test let through.
 */
contract QuorumAfterARelaxedPolicyTest is GovernanceTest {
    /// Signatures that meet a policy relaxed after they were given do not
    /// make a quorum by themselves: the next signature does, and only then
    /// may the proposal be executed.
    function test_TheNextSignatureReachesTheQuorumARelaxedPolicyAllows() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(1, NONE, ALL, 0));

        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(id, A);

        sign(id, B);
        assertState(id, IGovernanceTypes.ProposalState.APPROVED);
        execute(id, A);
        assertState(id, IGovernanceTypes.ProposalState.EXECUTED);
    }

    /// When the quorum was reached is kept past 2106, where a uint32 of
    /// seconds runs out.
    function test_RecordsWhenTheQuorumWasReachedPast2106() public {
        uint64 later = uint64(type(uint32).max) + 100;
        vm.warp(later);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(id, B);
        assertEq(governance.getProposal(id).executableAt, later, "executable at");
    }
}

contract RuleChangeRecordTest is GovernanceTest {
    function test_ShowsTheRolesThatSignedARuleChange() public {
        vm.prank(A);
        uint256 id = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        assertEq(governance.getAdminProposal(id).rolesSignedMask, only(ROLE_A), "proposer's role");
    }

    /// The proposer is the caller, not the account that sent the transaction.
    function test_NamesTheCallerAsTheProposer() public {
        vm.expectEmit(address(governance));
        emit IRuleChanges.AdminProposalCreated(1, TI_ID, IGovernanceTypes.AdminAction.ADD_SIGNER, A);
        vm.prank(A);
        governance.proposeAddSigner(TI_ID, spare, ROLE_A);
    }

    function test_NamesTheRoleARemovedKeyHad() public {
        addSigner(A, B, spare, ROLE_A);
        vm.prank(A);
        uint256 id = governance.proposeRemoveSigner(TI_ID, spare);
        vm.expectEmit(address(governance));
        emit ITiConfiguration.SignerRemoved(TI_ID, spare, ROLE_A);
        signAdmin(id, B);
    }
}

contract OpenProposalRecordTest is GovernanceTest {
    /// A stale proposal a new one replaced is recorded as expired, not only
    /// shown so: it cannot be expired again.
    function test_RecordsTheStaleProposalANewOneReplaced() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        skip(pilotTtl);
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        governance.expireProposal(1);
    }

    function test_ACancelledProposalIsNoLongerTheCertificatesOpenOne() public {
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        cancel(id, B, REASON);
        assertEq(governance.openProposalFor(CERTIFICATE), 0);
    }
}

contract TaoTest is GovernanceTest {
    bytes32 internal constant NEW_ATTRIBUTE = keccak256("new ti attribute");

    /// The owner acts as the TAO only while the DID Registry shows its key
    /// on the TAO's DID.
    function test_RevertWhen_TheOwnerNoLongerControlsTheTaosDid() public {
        _accreditNewAttribute();
        StubDidRegistry(didRegistry).setController(bytes(taoDid), tao, false);
        vm.prank(tao);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE);
    }

    function test_ANewAttributeIsANewVersion() public {
        _accreditNewAttribute();
        vm.prank(tao);
        governance.setTiAttribute(TI_ID, NEW_ATTRIBUTE);
        assertEq(governance.getTi(TI_ID).version, 1);
        assertEq(governance.getTi(TI_ID).attributeId, NEW_ATTRIBUTE);
    }

    function _accreditNewAttribute() private {
        issuers.accredit(TI_DID, NEW_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
    }
}

contract TrustChainGapsTest is GovernanceTest {
    /// A TI accredited by another TAO is not this contract's, whichever
    /// way that TAO's DID compares (the two hashes are below and above
    /// keccak256("did:ebsi:zTao")).
    function test_ATiOfAnotherTaoIsNotActive() public {
        _assertNotActiveUnder("did:ebsi:zSecondTao");
        _assertNotActiveUnder("did:ebsi:zOtherTao");
    }

    /// The chain stops at the first link that is not a TAO, even with the
    /// RootTAO above it.
    function test_ATaoAccreditedAsATiBreaksTheChain() public {
        bytes32 tiTyped = keccak256("tao attribute typed as TI");
        issuers.accredit(taoDid, tiTyped, IEbsiIssuersRegistry.IssuerType.TI, ROOT_DID, ROOT_ATTRIBUTE);
        issuers.accredit("did:ebsi:zNewTi", TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, tiTyped);
        assertFalse(governance.isActiveTi("did:ebsi:zNewTi", TI_ATTRIBUTE));
    }

    function _assertNotActiveUnder(string memory otherTao) private {
        bytes32 attribute = keccak256(bytes(otherTao));
        issuers.accredit(otherTao, attribute, IEbsiIssuersRegistry.IssuerType.TAO, ROOT_DID, ROOT_ATTRIBUTE);
        issuers.accredit("did:ebsi:zNewTi", attribute, IEbsiIssuersRegistry.IssuerType.TI, otherTao, attribute);
        assertFalse(governance.isActiveTi("did:ebsi:zNewTi", attribute), otherTao);
    }
}

contract ConfigurationGapsTest is GovernanceTest {
    /// The lifetime must outlast every policy's timelock, the first kind's
    /// (SUSPEND) too.
    function test_RevertWhen_TheLifetimeIsShorterThanTheSuspensionTimelock() public {
        setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(2, NONE, ALL, 3 * DAY));
        uint64 tooShort = 3 * DAY + governance.MIN_SIGNING_WINDOW() - 1;
        vm.prank(A);
        vm.expectRevert(IGovernanceTypes.InvalidTtl.selector);
        governance.proposeProposalTtl(TI_ID, tooShort);
    }

    function test_AllowsATimelockOfExactly90Days() public {
        uint64 longest = governance.MAX_TIMELOCK();
        setTtl(A, B, longest + governance.MIN_SIGNING_WINDOW());
        setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(2, NONE, ALL, longest));
        assertEq(governance.getTi(TI_ID).policies[uint8(IGovernanceTypes.PolicyKind.SUSPEND)].timelock, longest);
    }

    function test_RevertWhen_FewerKeysThanRoles() public {
        vm.expectRevert(IGovernanceTypes.InvalidSigner.selector);
        deploy(keys(A, B), roles(ROLE_A, ROLE_B, ROLE_C), pilotPolicies(), pilotTtl);
    }

    /// Two cosigners in either order (their DIDs' hashes compare both
    /// ways), and the same DID twice refused.
    function test_TakesDistinctCosignersInAnyOrderAndRefusesADuplicate() public {
        _setCosigners("did:ebsi:zSecondTao", "did:ebsi:zOtherTao");
        _setCosigners("did:ebsi:zOtherTao", "did:ebsi:zSecondTao");
        assertEq(governance.getTi(TI_ID).cosigners.length, 2);

        vm.expectRevert(IGovernanceTypes.InvalidCosigner.selector);
        _setCosigners("did:ebsi:zOtherTao", "did:ebsi:zOtherTao");
    }

    function _setCosigners(string memory first, string memory second) private {
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](2);
        list[0] = IGovernanceTypes.Cosigner(first, ROLE_C);
        list[1] = IGovernanceTypes.Cosigner(second, ROLE_C);
        vm.prank(tao);
        governance.setCosigners(TI_ID, list);
    }
}
