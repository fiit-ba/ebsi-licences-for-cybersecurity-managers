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
        return
            policy.threshold != 0 && policy.requiredRoleMask.count() <= policy.threshold && reachable(policy, present);
    }

    /// @dev Whether the roles present can meet a policy, and veto under it:
    ///      a timelock nobody can interrupt protects against neither a rash
    ///      nor a compromised decision (component 10.4).
    function reachable(IGovernanceTypes.Policy memory policy, RoleSet present) internal pure returns (bool) {
        return present.count() >= policy.threshold && present.includesAll(policy.requiredRoleMask)
            && present.intersects(policy.vetoRoleMask);
    }

    /// @dev `admin` waits as long as `decision` and has all its veto roles.
    function covers(IGovernanceTypes.Policy memory admin, IGovernanceTypes.Policy memory decision)
        internal
        pure
        returns (bool)
    {
        return admin.timelock >= decision.timelock && admin.vetoRoleMask.includesAll(decision.vetoRoleMask);
    }

    /// @dev Every set of roles meeting `next` meets `previous`, each role
    ///      that could veto still can, and it waits as long. A change mixing
    ///      stricter and looser is looser.
    function asStrictAs(IGovernanceTypes.Policy memory next, IGovernanceTypes.Policy memory previous)
        internal
        pure
        returns (bool)
    {
        return next.threshold >= previous.threshold && next.requiredRoleMask.includesAll(previous.requiredRoleMask)
            && next.vetoRoleMask.includesAll(previous.vetoRoleMask) && next.timelock >= previous.timelock;
    }

    function meets(IGovernanceTypes.Policy memory policy, RoleSet signed) internal pure returns (bool) {
        return signed.count() >= policy.threshold && signed.includesAll(policy.requiredRoleMask);
    }

    /// @dev Whether `action` changes a certificate of `standing`: a suspension
    ///      only of a valid one, a reinstatement only of a suspended one, a
    ///      revocation of either.
    function changes(IGovernanceTypes.ActionType action, IGovernanceTypes.Standing standing)
        internal
        pure
        returns (bool)
    {
        if (action == IGovernanceTypes.ActionType.SUSPEND) return standing == IGovernanceTypes.Standing.VALID;
        if (action == IGovernanceTypes.ActionType.REINSTATE) return standing == IGovernanceTypes.Standing.SUSPENDED;
        return standing == IGovernanceTypes.Standing.VALID || standing == IGovernanceTypes.Standing.SUSPENDED;
    }

    /// @dev The policy that governs an action: the two enums share their indexes.
    function policyKind(IGovernanceTypes.ActionType actionType) internal pure returns (IGovernanceTypes.PolicyKind) {
        return IGovernanceTypes.PolicyKind(uint8(actionType));
    }
}
