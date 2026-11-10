// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";

/**
 * A policy change reaches proposals already open: the rules that apply are the
 * rules in force when a proposal is decided, not when it was opened. Stricter
 * rules therefore cannot be dodged by opening a proposal just before them, and
 * looser ones - themselves a rule change the quorum approved - apply at once.
 */
contract PolicyChangeOnOpenProposalsTest is GovernanceTest {
    function test_AHigherThresholdHoldsBackAProposalThatHadNotReachedQuorum() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(3, NONE, ALL, 0));
        sign(1, B);
        assertState(1, IGovernanceTypes.ProposalState.PROPOSED);
        sign(1, C);
        assertState(1, IGovernanceTypes.ProposalState.APPROVED);
    }

    function test_ANewlyRequiredRoleHoldsBackExecutionOfAProposalThatHadQuorum() public {
        propose(A, CERTIFICATE, IGovernanceTypes.ActionType.SUSPEND, REASON_GIVEN);
        sign(1, B);
        setPolicy(A, B, IGovernanceTypes.PolicyKind.SUSPEND, policy(2, only(ROLE_C), ALL, 0));
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        execute(1, A);
        sign(1, C);
        execute(1, A);
    }
}
