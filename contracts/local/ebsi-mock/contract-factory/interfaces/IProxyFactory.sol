// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import {IContractsRegistryErrors} from "./IContractsRegistryErrors.sol";

interface IProxyFactory is IContractsRegistryErrors {
    // --- Errors ---
    error NotAuthorizedMissingPolicy();
    error NotAuthorizedContractNotActive();
    error DidRegistryNotSet();
    error NotAuthorizedMissingDidAuthorization();
    error ProxyTemplatesRegistryCannotBeZero();
    error ProxyTemplatesRegistryNotAContract();
    error DidRegistryCannotBeZero();
    error DidRegistryNotAContract();
    error IndexOutOfBounds();
    error TemplateNameRequired();
    error TemplateVersionRequired();
    error TemplateNotFound();
    error TemplateNotActive();
    error ImplementationInitSelectorIsZero();
    error TemplateInitSelectorIsZero();
    error DeploymentNotFound();
    error ProxyOwnerCannotBeZero();
    error DeployerCannotBeZero();

    struct DeploymentInfo {
        bytes32 templateId;
        address deployer;
        uint256 deploymentTimestamp;
        bool isActive;
        string deployerDID;
        address owner;
    }

    // Emitted on every deployment for logging & observability.
    // `initData` is the calldata actually executed against the proxy
    // (after any init-selector prepending by the factory).
    event ProxyDeployed(
        address indexed proxyAddress,
        bytes32 indexed templateId,
        address indexed deployer,
        address owner,
        string deployerDID,
        bytes initData,
        uint256 timestamp
    );

    event DidRegistrySet(address indexed didRegistry);

    event PoliciesRegistrySet(address indexed policiesRegistry);

    event DeploymentActiveUpdated(address indexed proxyAddress, bool isActive);

    function setDidRegistry(address _didRegistry) external;

    function setPoliciesRegistry(address _policiesRegistry) external;

    /**
     * @notice Activate or deactivate a factory-registered proxy for further deployments.
     * @dev Revocation and deploy-opt-in are per registered proxy, not per DID.
     *      `isAuthorized` checks only `deployments[msg.sender].isActive`.
     *
     *      Nested deploys (caller is a factory-registered proxy) copy the parent's
     *      `deployerDID` but register the child as `isActive = false`. The governor
     *      must call this function with `active = true` on each proxy that is allowed
     *      to deploy further. EOA and governor deploys start active.
     *
     *      Deactivating a parent does not change already opted-in descendants.
     *      To stop a compromised DID from spawning more proxies, deactivate each
     *      address in `didToProxies[did]` that was opted in (use `getProxiesByDIDCount`
     *      / `getProxiesByDIDAtIndex` when the list is large), or remove `ProxyFactory:deployProxy`
     *      from every caller that still holds it.
     *      `isActive` is also what the Authorisation API uses for that contract instance.
     *
     *      Deactivated proxies cannot deploy (empty DID or explicit DID) via this factory.
     */
    function setDeploymentActive(address proxyAddress, bool active) external;

    function deployProxy(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        string calldata deployerDID,
        address owner
    ) external returns (address);

    function deployProxyWithSalt(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        string calldata deployerDID,
        bytes32 salt,
        address owner
    ) external returns (address);

    /**
     * @notice Predict the CREATE2 address for {deployProxyWithSalt}.
     * @dev Salt is `keccak256(abi.encodePacked(initData, salt, deployer))`.
     *      Pass the account that will call {deployProxyWithSalt}; that path
     *      binds the salt to `msg.sender`, not to this view function's caller.
     *      `eth_call` without `from` would otherwise hash `address(0)` and
     *      return an address no real deployer can occupy.
     * @param deployer Account that will submit {deployProxyWithSalt}.
     */
    function computeAddress(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        bytes32 salt,
        address owner,
        address deployer
    ) external view returns (address);

    function getProxiesByDID(string calldata deployerDID) external view returns (address[] memory);

    function getProxiesByDIDCount(string calldata deployerDID) external view returns (uint256);

    function getProxiesByDIDAtIndex(string calldata deployerDID, uint256 index) external view returns (address);

    function getDeploymentInfo(address contractAddress) external view returns (DeploymentInfo memory);

    function getContractsByTemplate(bytes32 templateId, uint256 page, uint256 pageSize)
        external
        view
        returns (address[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);

    function getDeployedContracts(uint256 page, uint256 pageSize)
        external
        view
        returns (address[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next);
    function getDeployedContractsCount() external view returns (uint256);
    function isContractDeployed(address contractAddress) external view returns (bool);
}
