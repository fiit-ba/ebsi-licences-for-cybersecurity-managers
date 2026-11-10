// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IGovernanceTypes} from "../interfaces/IGovernanceTypes.sol";
import {RoleSet} from "./Roles.sol";

/**
 * @title PolicyRules
 * @notice What a policy means for a set of roles.
 */
library PolicyRules {
    /// @dev The policy says something coherent, and the roles present can meet it.
    function wellFormed(IGovernanceTypes.Policy memory policy, RoleSet present) internal pure returns (bool) {
        return policy.threshold != 0 && policy.requiredRoleMask.count() <= policy.threshold
            && reachable(policy, present);
    }

    /// @dev Whether the roles present can meet a policy, and veto under it:
    ///      a timelock nobody can interrupt protects against neither a rash
    ///      nor a compromised decision (component 10.4).
    function reachable(IGovernanceTypes.Policy memory policy, RoleSet present) internal pure returns (bool) {
        return present.count() >= policy.threshold && present.includesAll(policy.requiredRoleMask)
            && present.intersects(policy.vetoRoleMask);
    }

    function meets(IGovernanceTypes.Policy memory policy, RoleSet signed) internal pure returns (bool) {
        return signed.count() >= policy.threshold && signed.includesAll(policy.requiredRoleMask);
    }

    /// @dev The policy that governs an action: the two enums share their indexes.
    function policyKind(IGovernanceTypes.ActionType actionType) internal pure returns (IGovernanceTypes.PolicyKind) {
        return IGovernanceTypes.PolicyKind(uint8(actionType));
    }
}
