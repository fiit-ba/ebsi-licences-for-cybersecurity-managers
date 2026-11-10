// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

/// @dev Role and RoleSet were both bare `uint8` once: `requiredRoles = 3`
///      compiled and ran, but meant {A, B} (0b011), not role C. Two types
///      stop that mix-up in-contract; the ABI still uses `uint8` for both,
///      so a set is named `...Mask` instead (D21).

/// @notice One organisational role of component 10.2, numbered 1..8; 0 is no role.
type Role is uint8;

/// @notice A set of roles, one bit per role: bit 0 is role 1.
type RoleSet is uint8;

using {toSet} for Role global;
using {contains, with, includesAll, intersects, count} for RoleSet global;

/// @dev The set holding just `role`; empty for role 0.
function toSet(Role role) pure returns (RoleSet) {
    if (Role.unwrap(role) == 0) return RoleSet.wrap(0);
    return RoleSet.wrap(uint8(1) << (Role.unwrap(role) - 1));
}

function contains(RoleSet set, Role role) pure returns (bool) {
    return Role.unwrap(role) != 0 && RoleSet.unwrap(set) & RoleSet.unwrap(role.toSet()) != 0;
}

/// @dev `set` with `role` added.
function with(RoleSet set, Role role) pure returns (RoleSet) {
    return RoleSet.wrap(RoleSet.unwrap(set) | RoleSet.unwrap(role.toSet()));
}

/// @dev True when every role of `other` is in `set`.
function includesAll(RoleSet set, RoleSet other) pure returns (bool) {
    return RoleSet.unwrap(set) & RoleSet.unwrap(other) == RoleSet.unwrap(other);
}

/// @dev True when the two sets share a role.
function intersects(RoleSet set, RoleSet other) pure returns (bool) {
    return RoleSet.unwrap(set) & RoleSet.unwrap(other) != 0;
}

/// @dev How many roles the set holds.
function count(RoleSet set) pure returns (uint8 n) {
    for (uint8 bits = RoleSet.unwrap(set); bits != 0; bits &= bits - 1) {
        n++;
    }
}
