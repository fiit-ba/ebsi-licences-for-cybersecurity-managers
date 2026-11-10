// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

interface IPoliciesRegistry {
    function checkPolicy(string calldata policyName, address user) external view returns (bool);

    function checkPolicy(uint256 policyId, address user) external view returns (bool);
}
