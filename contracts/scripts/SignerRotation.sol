// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {ICertificateGovernance} from "../contracts/interfaces/ICertificateGovernance.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";

/**
 * Key rotation through the contract's own quorum (component 10.4).
 *
 * What moves the pilot's genesis keys off the contract and the KMS role keys
 * on, without redeploying and so without breaking the back-office's link from
 * each case file to its proposal number. Kept apart from the script that runs
 * it so the tests can drive it: it changes who may sign on a live multisig,
 * and that is not something to ship untested.
 */
abstract contract SignerRotation {
    /// The supervisory authority's role (component 10.2). Its key is the
    /// external signer's own, never rotated by the body.
    Role internal constant SUPERVISORY = Role.wrap(3);

    struct Target {
        Role role;
        address key;
    }

    error SupervisoryKeyNotRotatable();
    error SameKeyForTwoRoles();
    /// The rule-change policy needs `needed` roles, and only `available` of
    /// the accounts given hold one.
    error NotEnoughApprovers(uint8 needed, uint256 available);

    /// Send the next call as `account`: a prank in tests, a broadcast in a script.
    function _as(address account) internal virtual;

    /**
     * Make each target key the key of its role.
     *
     * A role that has a different key gets it replaced in one step - the
     * quorum never changes - and a role without a key gets one added. Each
     * change is a rule change approved under the ADMIN policy by `accounts`
     * that are signers. Returns the ids of the rule changes made; one still
     * in its timelock has to be executed later.
     */
    function _rotateSigners(
        ICertificateGovernance governance,
        bytes32 tiId,
        address[] memory accounts,
        Target[] memory target
    )
        internal
        returns (uint256[] memory changes)
    {
        for (uint256 i = 0; i < target.length; i++) {
            if (Role.unwrap(target[i].role) == Role.unwrap(SUPERVISORY)) revert SupervisoryKeyNotRotatable();
            for (uint256 j = 0; j < i; j++) {
                if (target[j].key == target[i].key) revert SameKeyForTwoRoles();
            }
        }

        changes = new uint256[](target.length);
        uint256 made;
        for (uint256 i = 0; i < target.length; i++) {
            (Role role, address key) = (target[i].role, target[i].key);
            if (Role.unwrap(governance.roleOf(tiId, key)) == Role.unwrap(role)) continue;

            address current = _keyOf(governance, tiId, role);
            address[] memory chosen = _approvers(governance, tiId, accounts);
            _as(chosen[0]);
            uint256 id = current != address(0)
                ? governance.proposeReplaceSigner(tiId, current, key)
                : governance.proposeAddSigner(tiId, key, role);
            for (uint256 j = 1; j < chosen.length; j++) {
                _as(chosen[j]);
                governance.signAdminProposal(id);
            }
            changes[made++] = id;
        }
        assembly {
            mstore(changes, made)
        }
    }

    /**
     * Accounts among `accounts` that are signers, one per role, enough to
     * meet the ADMIN policy - its required roles first.
     */
    function _approvers(ICertificateGovernance governance, bytes32 tiId, address[] memory accounts)
        internal
        view
        returns (address[] memory chosen)
    {
        IGovernanceTypes.Policy memory admin = governance.getPolicy(tiId, IGovernanceTypes.PolicyKind.ADMIN);

        // One account per role, in the order given.
        address[] memory byRole = new address[](9);
        RoleSet present;
        for (uint256 i = 0; i < accounts.length; i++) {
            Role role = governance.roleOf(tiId, accounts[i]);
            if (Role.unwrap(role) != 0 && !present.contains(role)) {
                byRole[Role.unwrap(role)] = accounts[i];
                present = present.with(role);
            }
        }

        uint8 needed =
            admin.threshold > admin.requiredRoleMask.count() ? admin.threshold : admin.requiredRoleMask.count();
        chosen = new address[](needed);
        uint256 n;
        // Required roles first, then any other, until the threshold.
        for (uint256 pass = 0; pass < 2; pass++) {
            for (uint8 r = 1; r <= 8 && n < needed; r++) {
                Role role = Role.wrap(r);
                bool required = admin.requiredRoleMask.contains(role);
                if (present.contains(role) && (pass == 0) == required) chosen[n++] = byRole[r];
            }
        }
        if (n < admin.threshold) revert NotEnoughApprovers(admin.threshold, n);
        assembly {
            mstore(chosen, n)
        }
    }

    /// The first key holding `role`, or zero.
    function _keyOf(ICertificateGovernance governance, bytes32 tiId, Role role) internal view returns (address) {
        IGovernanceTypes.TiView memory ti = governance.getTi(tiId);
        for (uint256 i = 0; i < ti.signers.length; i++) {
            if (Role.unwrap(ti.roles[i]) == Role.unwrap(role)) return ti.signers[i];
        }
        return address(0);
    }
}
