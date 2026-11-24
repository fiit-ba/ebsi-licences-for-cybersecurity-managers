pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {PolicyRules} from "../../contracts/libraries/PolicyRules.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";

/**
 * What every quorum decision rests on, proved for every input rather than
 * sampled: Halmos explores each `check_` function symbolically.
 *
 *   halmos --match-contract LibrariesSymbolicTest --loop 9
 *
 * (`--loop 9`: `count` walks up to eight bits.) `forge test` runs none of
 * them; test/fuzz/Libraries.t.sol samples the same properties.
 */
contract LibrariesSymbolicTest is Test {
    using PolicyRules for IGovernanceTypes.Policy;

    /// Bits set, without a loop: the reference shares no code with `count`.
    function _popcount(uint8 x) private pure returns (uint8) {
        x = x - ((x >> 1) & 0x55);
        x = (x & 0x33) + ((x >> 2) & 0x33);
        return (x + (x >> 4)) & 0x0f;
    }

    function _bit(uint8 role) private pure returns (uint8) {
        return role == 0 || role > 8 ? 0 : uint8(1) << (role - 1);
    }

    // -----------------------------------------------------------------------
    // Roles
    // -----------------------------------------------------------------------

    function check_ARoleSetIsItsBits(uint8 set, uint8 role, uint8 other) public pure {
        RoleSet s = RoleSet.wrap(set);
        Role r = Role.wrap(role);
        assert(RoleSet.unwrap(r.toSet()) == _bit(role));
        assert(s.contains(r) == (set & _bit(role) != 0));
        assert(RoleSet.unwrap(s.with(r)) == set | _bit(role));
        assert(s.includesAll(RoleSet.wrap(other)) == (set & other == other));
        assert(s.intersects(RoleSet.wrap(other)) == (set & other != 0));
    }

    function check_CountIsTheBitsSet(uint8 set) public pure {
        assert(RoleSet.wrap(set).count() == _popcount(set));
    }

    // -----------------------------------------------------------------------
    // Policies
    // -----------------------------------------------------------------------

    /// What the contract accepts as a policy, the roles present can meet:
    /// a well-formed policy is never a trap.
    function check_AWellFormedPolicyCanBeMet(uint8 threshold, uint8 required, uint8 veto, uint8 present) public pure {
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(veto), 0);
        if (policy.wellFormed(RoleSet.wrap(present))) {
            assert(policy.meets(RoleSet.wrap(present)));
            assert(present & veto != 0); // and someone present may veto
        }
    }

    /// One more role signed never loses a quorum.
    function check_MeetingIsMonotonic(uint8 threshold, uint8 required, uint8 signed, uint8 more) public pure {
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(0), 0);
        if (policy.meets(RoleSet.wrap(signed))) assert(policy.meets(RoleSet.wrap(signed | more)));
    }

    /// A quorum needs the threshold's number of distinct roles, and every
    /// required one: a single role never decides alone under a threshold
    /// above one.
    function check_AQuorumIsWhatItSays(uint8 threshold, uint8 required, uint8 signed) public pure {
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(0), 0);
        bool met = policy.meets(RoleSet.wrap(signed));
        assert(met == (_popcount(signed) >= threshold && signed & required == required));
        if (threshold > 1 && _popcount(signed) == 1) assert(!met);
    }

    /// Reachable is exactly: enough roles present, every required one among
    /// them, and one that may veto.
    function check_ReachableIsItsDefinition(uint8 threshold, uint8 required, uint8 veto, uint8 present) public pure {
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(veto), 0);
        assert(
            policy.reachable(RoleSet.wrap(present))
                == (_popcount(present) >= threshold && present & required == required && present & veto != 0)
        );
    }
}
