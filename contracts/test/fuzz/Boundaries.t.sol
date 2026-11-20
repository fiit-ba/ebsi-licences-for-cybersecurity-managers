pragma solidity 0.8.26;

import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {GovernanceTest} from "../GovernanceTest.sol";

/**
 * The seconds where time changes what a proposal may do, for any lifetime
 * and timelock: open until the second its lifetime ends, executable from the
 * second its timelock ends. The invariant handler waits at random and seldom
 * lands on either.
 */
contract BoundariesFuzzTest is GovernanceTest {
    function testFuzz_AProposalExpiresTheSecondItsLifetimeEnds(uint64 ttl) public {
        ttl = uint64(bound(ttl, DAY + governance.MIN_SIGNING_WINDOW(), governance.MAX_PROPOSAL_TTL()));
        setTtl(A, B, ttl);
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        uint256 opened = block.timestamp;

        vm.warp(opened + ttl - 1);
        assertState(id, IGovernanceTypes.ProposalState.PROPOSED);
        vm.expectRevert(IGovernanceTypes.ProposalNotExpirable.selector);
        governance.expireProposal(id);

        vm.warp(opened + ttl);
        assertState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        sign(id, B);
        governance.expireProposal(id);
    }

    function testFuzz_ARuleChangeExpiresTheSecondItsLifetimeEnds(uint64 ttl) public {
        ttl = uint64(bound(ttl, DAY + governance.MIN_SIGNING_WINDOW(), governance.MAX_PROPOSAL_TTL()));
        setTtl(A, B, ttl);
        vm.prank(A);
        uint256 id = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        uint256 opened = block.timestamp;

        vm.warp(opened + ttl - 1);
        assertAdminState(id, IGovernanceTypes.ProposalState.PROPOSED);
        vm.warp(opened + ttl);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXPIRED);
        vm.expectRevert(IGovernanceTypes.ProposalNotOpen.selector);
        signAdmin(id, B);
    }

    function testFuzz_AQuorumExecutesTheSecondItsTimelockEnds(uint64 timelock) public {
        timelock = uint64(bound(timelock, 1, pilotTtl - governance.MIN_SIGNING_WINDOW()));
        setPolicy(A, B, IGovernanceTypes.PolicyKind.REVOKE, policy(2, NONE, ALL, timelock));
        uint256 id = propose(A, CERTIFICATE, IGovernanceTypes.ActionType.REVOKE, REASON_GIVEN);
        sign(id, B);
        uint64 executableAt = governance.getProposal(id).executableAt;
        assertEq(executableAt, block.timestamp + timelock, "executable at");

        vm.warp(executableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        execute(id, A);
        vm.warp(executableAt);
        execute(id, A);
        assertState(id, IGovernanceTypes.ProposalState.EXECUTED);
    }

    function testFuzz_ARuleChangeAppliesTheSecondItsTimelockEnds(uint64 timelock) public {
        timelock = uint64(bound(timelock, 1, pilotTtl - governance.MIN_SIGNING_WINDOW()));
        setPolicy(A, B, IGovernanceTypes.PolicyKind.ADMIN, policy(2, NONE, ALL, timelock));
        vm.prank(A);
        uint256 id = governance.proposeAddSigner(TI_ID, spare, ROLE_A);
        signAdmin(id, B);
        uint64 executableAt = governance.getAdminProposal(id).executableAt;
        assertEq(executableAt, block.timestamp + timelock, "executable at");

        vm.warp(executableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IGovernanceTypes.TimelockNotElapsed.selector, executableAt));
        executeAdmin(id, A);
        vm.warp(executableAt);
        executeAdmin(id, A);
        assertAdminState(id, IGovernanceTypes.ProposalState.EXECUTED);
    }
}
