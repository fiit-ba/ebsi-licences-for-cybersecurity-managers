// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title IPoliciesRegistry
 * @author EBSI
 * @notice Interface for the Policies Registry: policy definitions and user policy assignments (EBSI global or per-target contract).
 */
interface IPoliciesRegistry {
    // --- Errors ---
    error NotOperatorOrOwner();
    error PolicyInactiveOrNotDefined();
    error PolicyNameRequired();
    error DescriptionRequired();
    error PolicyExists();
    error PolicyInactive();
    error InvalidDescription();
    error InvalidPolicy();
    error PolicyAlreadyActive();
    error PageSizeTooLarge();
    error PageSizeZero();
    error PageZero();
    error InvalidUserAddress();
    error InvalidAttrList();
    error AttributeEmpty();
    error PolicyDoesNotExist();
    error AttributeAlreadyDefined();
    error AttrInvalid();
    error UserDoesNotExist();
    error UserHasNoAttribute();

    // --- Events ---
    /// @notice Emitted when a new policy definition is inserted.
    /// @param policyId Unique policy identifier.
    /// @param policyName Policy name (unique).
    /// @param description Policy description.
    event PolicyInserted(uint256 indexed policyId, string policyName, string description);

    /// @notice Emitted when a policy description is updated.
    /// @param policyId Policy identifier.
    /// @param oldDescription Previous description.
    /// @param newDescription New description.
    event PolicyUpdated(uint256 indexed policyId, string oldDescription, string newDescription);

    /// @notice Emitted when a policy is deactivated.
    /// @param policyId Policy identifier.
    event PolicyDeactivated(uint256 indexed policyId);

    /// @notice Emitted when a policy is activated.
    /// @param policyId Policy identifier.
    event PolicyActivated(uint256 indexed policyId);

    /// @notice Emitted when a user is assigned a policy (attribute) for a scope.
    /// @param user User address.
    /// @param attribute Policy name (attribute) assigned.
    /// @param targetContract address(0) for EBSI global; beacon proxy address for per-contract scope.
    event UserAttributeInserted(address user, string attribute, address targetContract);

    /// @notice Emitted when a user policy assignment is removed.
    /// @param user User address.
    /// @param attribute Policy name (attribute) removed.
    /// @param targetContract address(0) for EBSI global; beacon proxy address for per-contract scope.
    event UserAttributeDeleted(address user, string attribute, address targetContract);

    /// @notice Legacy struct for backward compatibility (index in list).
    struct UserAttribute {
        bool defined;
        uint256 index;
    }

    /// @notice Policy definition: name, description, and active flag.
    struct Policy {
        string policyName; // policyName matches attribute name for user assignments
        string description;
        bool status;
    }

    /// @notice Returns policy names for the given policy IDs (for API-side pagination).
    /// @param policyIds List of policy identifiers.
    /// @return names Policy names in the same order as policyIds.
    function getPolicyNamesByIds(uint256[] calldata policyIds) external view returns (string[] memory names);

    /// @notice Returns whether the user has the given policy (by name). Uses msg.sender as target contract scope.
    /// @param policyName Policy name (must exist as a policy definition).
    /// @param user User address to check.
    /// @return True if user has the policy for msg.sender or for EBSI global (address(0)).
    function checkPolicy(string calldata policyName, address user) external view returns (bool);

    /// @notice Returns whether the user has the given policy (by id). Uses msg.sender as target contract scope.
    /// @param policyId Policy identifier.
    /// @param user User address to check.
    /// @return True if user has the policy for msg.sender or for EBSI global (address(0)).
    function checkPolicy(uint256 policyId, address user) external view returns (bool);
}
