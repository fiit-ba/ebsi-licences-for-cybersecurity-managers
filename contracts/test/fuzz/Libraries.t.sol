pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {PolicyRules} from "../../contracts/libraries/PolicyRules.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";

/**
 * The libraries against a plain reference: a role set is a byte with bit
 * `role - 1` per role, and a policy is met by counting bits.
 */
contract LibrariesFuzzTest is Test {
    using PolicyRules for IGovernanceTypes.Policy;

    // -----------------------------------------------------------------------
    // Reference
    // -----------------------------------------------------------------------

    function _bit(uint8 role) private pure returns (uint8) {
        return role == 0 || role > 8 ? 0 : uint8(1) << (role - 1);
    }

    function _popcount(uint8 bits) private pure returns (uint8 n) {
        for (uint8 i = 0; i < 8; i++) {
            n += (bits >> i) & 1;
        }
    }

    function _reachable(uint8 threshold, uint8 required, uint8 veto, uint8 present) private pure returns (bool) {
        return _popcount(present) >= threshold && present & required == required && present & veto != 0;
    }

    // -----------------------------------------------------------------------
    // Roles
    // -----------------------------------------------------------------------

    function testFuzz_ARoleSetIsItsBits(uint8 set, uint8 role, uint8 other) public pure {
        RoleSet s = RoleSet.wrap(set);
        Role r = Role.wrap(role);
        assertEq(RoleSet.unwrap(r.toSet()), _bit(role), "toSet");
        assertEq(s.contains(r), set & _bit(role) != 0, "contains");
        assertEq(RoleSet.unwrap(s.with(r)), set | _bit(role), "with");
        assertEq(s.count(), _popcount(set), "count");
        assertEq(s.includesAll(RoleSet.wrap(other)), set & other == other, "includesAll");
        assertEq(s.intersects(RoleSet.wrap(other)), set & other != 0, "intersects");
    }

    function testFuzz_AddingARoleNeverDropsOne(uint8 set, uint8 role) public pure {
        RoleSet s = RoleSet.wrap(set);
        RoleSet grown = s.with(Role.wrap(role));
        assertTrue(grown.includesAll(s), "kept");
        assertLe(grown.count() - s.count(), 1, "at most one more");
        assertEq(RoleSet.unwrap(grown.with(Role.wrap(role))), RoleSet.unwrap(grown), "idempotent");
    }

    // -----------------------------------------------------------------------
    // Policies
    // -----------------------------------------------------------------------

    function testFuzz_APolicyMeansWhatItSays(
        uint8 threshold,
        uint8 required,
        uint8 veto,
        uint64 timelock,
        uint8 present,
        uint8 signed
    ) public pure {
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(veto), timelock);
        bool reachable = _reachable(threshold, required, veto, present);
        assertEq(policy.reachable(RoleSet.wrap(present)), reachable, "reachable");
        assertEq(
            policy.wellFormed(RoleSet.wrap(present)),
            threshold != 0 && _popcount(required) <= threshold && reachable,
            "wellFormed"
        );
        assertEq(
            policy.meets(RoleSet.wrap(signed)), _popcount(signed) >= threshold && signed & required == required, "meets"
        );
    }

    /// A well-formed policy can be met by the roles present: the quorum the
    /// contract accepts is one its signers can reach.
    function testFuzz_AWellFormedPolicyCanBeMet(uint8 threshold, uint8 required, uint8 veto, uint8 present)
        public
        pure
    {
        // Built well-formed rather than assumed: few random policies are.
        vm.assume(present != 0);
        required &= present;
        veto = (veto & present) | (present & (~present + 1)); // at least the lowest present role
        threshold = uint8(bound(threshold, _popcount(required) > 0 ? _popcount(required) : 1, _popcount(present)));
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(veto), 0);
        assertTrue(policy.wellFormed(RoleSet.wrap(present)), "built well-formed");
        assertTrue(policy.meets(RoleSet.wrap(present)), "all present roles meet it");
    }

    /// More signed roles never lose a quorum.
    function testFuzz_MeetingIsMonotonic(uint8 threshold, uint8 required, uint8 signed, uint8 more) public pure {
        // A quorum built to be met by `signed`, rather than assumed.
        required &= signed;
        threshold = uint8(bound(threshold, 0, _popcount(signed)));
        IGovernanceTypes.Policy memory policy =
            IGovernanceTypes.Policy(threshold, RoleSet.wrap(required), RoleSet.wrap(0), 0);
        assertTrue(policy.meets(RoleSet.wrap(signed)), "built to be met");
        assertTrue(policy.meets(RoleSet.wrap(signed | more)), "still met");
    }

    function testFuzz_AnActionHasItsOwnPolicy(uint8 action) public pure {
        action = uint8(bound(action, 0, 2));
        assertEq(uint8(PolicyRules.policyKind(IGovernanceTypes.ActionType(action))), action, "kind");
    }

    // -----------------------------------------------------------------------
    // Hashes
    // -----------------------------------------------------------------------

    function testFuzz_DifferentCertificatesHaveDifferentKeys(string memory did, string memory a, string memory b)
        public
        pure
    {
        vm.assume(keccak256(bytes(a)) != keccak256(bytes(b)));
        assertNotEq(
            Hashes.statusKey(did, Hashes.certificateIdHash(a)), Hashes.statusKey(did, Hashes.certificateIdHash(b))
        );
    }

    function testFuzz_TheSameCertificateOfAnotherTiHasAnotherKey(string memory a, string memory b, string memory id)
        public
        pure
    {
        vm.assume(keccak256(bytes(a)) != keccak256(bytes(b)));
        bytes32 idHash = Hashes.certificateIdHash(id);
        assertNotEq(Hashes.statusKey(a, idHash), Hashes.statusKey(b, idHash));
    }

    /// The reason's parts are length-prefixed: moving text between the code
    /// and the note changes the commitment.
    function testFuzz_AReasonCommitsToItsParts(string memory code, string memory note, bytes32 salt, bytes32 other)
        public
        pure
    {
        bytes32 committed = Hashes.reason(code, note, salt);
        if (bytes(code).length > 0) {
            assertNotEq(committed, Hashes.reason("", string.concat(code, note), salt), "code moved into note");
        }
        vm.assume(salt != other);
        assertNotEq(committed, Hashes.reason(code, note, other), "salt");
    }
}
