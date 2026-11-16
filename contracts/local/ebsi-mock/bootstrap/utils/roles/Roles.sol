// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title Roles
 * @dev Library for managing addresses assigned to a Role.
 */
library Roles {
    struct Role {
        mapping(address => bool) bearer;
    }

    /**
     * @dev Give an account access to this role.
     */
    function add(Role storage role, address account) internal {
        // prettier-ignore
        require(!has(role, account), "Account has role");
        role.bearer[account] = true;
    }

    /**
     * @dev Remove an account's access to this role.
     */
    function remove(Role storage role, address account) internal {
        // prettier-ignore
        require(has(role, account), "Account have no role");
        role.bearer[account] = false;
    }

    /**
     * @dev Check if an account has this role.
     * @return bool
     */
    function has(Role storage role, address account) internal view returns (bool) {
        // prettier-ignore
        require(account != address(0), "Account can't be zero");
        return role.bearer[account];
    }
}
