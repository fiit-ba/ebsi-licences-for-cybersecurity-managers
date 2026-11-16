// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import "./interfaces/IProxyTemplatesRegistry.sol";
import "./interfaces/IDidRegistry.sol";
import "./interfaces/IProxyFactory.sol";
import "./interfaces/IPoliciesRegistry.sol";
import "../beacon-proxy/VersionedBeaconProxy.sol";
import {IImplementationInitSelector} from "../bootstrap/interfaces/IImplementationInitSelector.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./libraries/Pagination.sol";

contract ProxyFactory is IProxyFactory, Initializable, AccessControlUpgradeable, ImplementationInitSelector {
    using Address for address;
    using Pagination for address[];

    // Policy names for EBSI ecosystem
    string public constant DEPLOY_PROXY_POLICY = "ProxyFactory:deployProxy";

    bytes32 public constant EBSI_GOVERNOR = keccak256("EBSI_GOVERNOR");

    // Custom modifier to check authorization
    modifier isAuthorized(string calldata deployerDID) {
        if (!hasRole(EBSI_GOVERNOR, msg.sender)) {
            if (address(policiesRegistry) == address(0)) {
                revert IContractsRegistryErrors.PoliciesRegistryNotSet();
            }
            if (!policiesRegistry.checkPolicy(DEPLOY_PROXY_POLICY, msg.sender)) {
                revert IProxyFactory.NotAuthorizedMissingPolicy();
            }
            // Registered deployments can be revoked via setDeploymentActive.
            // Unregistered callers (EOAs) have deployer == 0 and skip this.
            // Nested children are registered inactive; the governor must
            // setDeploymentActive(child, true) before they can deploy.
            if (deployments[msg.sender].deployer != address(0) && deployments[msg.sender].isActive == false) {
                revert IProxyFactory.NotAuthorizedContractNotActive();
            }
            if (bytes(deployerDID).length == 0) {
                // Empty DID: caller must be a registered, active proxy.
                if (deployments[msg.sender].deployer == address(0)) {
                    revert IProxyFactory.NotAuthorizedContractNotActive();
                }
            } else {
                if (address(didRegistry) == address(0)) {
                    revert IProxyFactory.DidRegistryNotSet();
                }
                if (!didRegistry.checkController(bytes(deployerDID), msg.sender)) {
                    revert IProxyFactory.NotAuthorizedMissingDidAuthorization();
                }
            }
        }
        _;
    }

    IProxyTemplatesRegistry public proxyTemplatesRegistry;
    IDidRegistry public didRegistry;
    IPoliciesRegistry public policiesRegistry;

    // Mapping from deployed contract address to deployment info
    mapping(address => DeploymentInfo) private deployments;
    address[] private deployedContracts;
    mapping(string => address[]) private didToProxies;
    mapping(bytes32 => address[]) private templateToProxies;

    // Events are defined in IProxyFactory interface

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _proxyTemplatesRegistry, address defaultAdmin, address ebsiGovernor)
        external
        initializer
    {
        __AccessControl_init();
        if (_proxyTemplatesRegistry == address(0)) {
            revert IProxyFactory.ProxyTemplatesRegistryCannotBeZero();
        }
        if (_proxyTemplatesRegistry.code.length == 0) {
            revert IProxyFactory.ProxyTemplatesRegistryNotAContract();
        }
        if (defaultAdmin == address(0)) {
            revert IContractsRegistryErrors.DefaultAdminCannotBeZero();
        }
        if (ebsiGovernor == address(0)) {
            revert IContractsRegistryErrors.EbsiGovernorCannotBeZero();
        }
        proxyTemplatesRegistry = IProxyTemplatesRegistry(_proxyTemplatesRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(EBSI_GOVERNOR, ebsiGovernor);
    }

    /**
     * @notice Returns the initializer selector for this implementation.
     */
    function getImplementationInitSelector() external pure override returns (bytes4) {
        return this.initialize.selector;
    }

    /**
     * @inheritdoc AccessControlUpgradeable
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlUpgradeable, ImplementationInitSelector)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function setDidRegistry(address _didRegistry) external override onlyRole(EBSI_GOVERNOR) {
        if (_didRegistry == address(0)) {
            revert IProxyFactory.DidRegistryCannotBeZero();
        }
        if (_didRegistry.code.length == 0) {
            revert IProxyFactory.DidRegistryNotAContract();
        }
        didRegistry = IDidRegistry(_didRegistry);
        emit DidRegistrySet(_didRegistry);
    }

    function setPoliciesRegistry(address _policiesRegistry) external override onlyRole(EBSI_GOVERNOR) {
        if (_policiesRegistry == address(0)) {
            revert IContractsRegistryErrors.PoliciesRegistryCannotBeZero();
        }
        if (_policiesRegistry.code.length == 0) {
            revert IContractsRegistryErrors.PoliciesRegistryNotAContract();
        }
        policiesRegistry = IPoliciesRegistry(_policiesRegistry);
        emit PoliciesRegistrySet(_policiesRegistry);
    }

    /**
     * @inheritdoc IProxyFactory
     */
    function setDeploymentActive(address proxyAddress, bool active) external override onlyRole(EBSI_GOVERNOR) {
        if (deployments[proxyAddress].deployer == address(0)) {
            revert IProxyFactory.DeploymentNotFound();
        }
        deployments[proxyAddress].isActive = active;
        emit DeploymentActiveUpdated(proxyAddress, active);
    }

    /// @dev Deploys {VersionedBeaconProxy} with empty constructor init, then calls `finalInitData`
    ///      so implementation `initialize` runs when proxy runtime code exists (required e.g. when
    ///      init performs `address(this).call(...)`). Same guarantee as {deployProxyWithSalt}.
    function deployProxy(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        string calldata deployerDID,
        address owner
    ) external override isAuthorized(deployerDID) returns (address) {
        if (owner == address(0)) revert IProxyFactory.ProxyOwnerCannotBeZero();

        (bytes32 templateId, IProxyTemplatesRegistry.ProxyTemplate memory template) =
            _loadActiveTemplate(templateName, templateVersion);

        bytes memory finalInitData = _prepareFinalInitData(initData, template);

        VersionedBeaconProxy proxy = new VersionedBeaconProxy(template.beaconAddress, bytes(""), owner);
        address proxyAddress = address(proxy);
        proxyAddress.functionCall(finalInitData);

        _registerDeployedProxy(templateId, proxyAddress, deployerDID, finalInitData, owner);
        return proxyAddress;
    }

    /// @dev CREATE2 deploys {BeaconProxy} with empty constructor init, then calls `finalInitData` on the
    ///      proxy so implementation `initialize` runs when proxy code is already deployed (required e.g.
    ///      when init performs `address(this).call(...)`).
    function deployProxyWithSalt(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        string calldata deployerDID,
        bytes32 salt,
        address owner
    ) external override isAuthorized(deployerDID) returns (address) {
        if (owner == address(0)) revert IProxyFactory.ProxyOwnerCannotBeZero();
        return _deployProxyWithSalt(templateName, templateVersion, initData, deployerDID, salt, owner);
    }

    function _deployProxyWithSalt(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        string calldata deployerDID,
        bytes32 salt,
        address proxyOwner
    ) internal returns (address) {
        (bytes32 templateId, IProxyTemplatesRegistry.ProxyTemplate memory template) =
            _loadActiveTemplate(templateName, templateVersion);

        bytes memory finalInitData = _prepareFinalInitData(initData, template);
        // Salt from caller-supplied initData (not finalInitData): the resolved
        // init selector is read live from the beacon and can change across upgrades.
        bytes32 actualSalt = _create2Salt(initData, salt, msg.sender);
        bytes memory bytecode = _beaconProxyCreationBytecode(template.beaconAddress, bytes(""), proxyOwner);
        address proxyAddress = Create2.deploy(0, actualSalt, bytecode);
        proxyAddress.functionCall(finalInitData);

        _registerDeployedProxy(templateId, proxyAddress, deployerDID, finalInitData, proxyOwner);
        return proxyAddress;
    }

    function computeAddress(
        string calldata templateName,
        string calldata templateVersion,
        bytes calldata initData,
        bytes32 salt,
        address owner,
        address deployer
    ) external view override returns (address) {
        if (owner == address(0)) revert IProxyFactory.ProxyOwnerCannotBeZero();
        if (deployer == address(0)) revert IProxyFactory.DeployerCannotBeZero();
        (, IProxyTemplatesRegistry.ProxyTemplate memory template) = _loadActiveTemplate(templateName, templateVersion);
        bytes32 actualSalt = _create2Salt(initData, salt, deployer);
        bytes memory bytecode = _beaconProxyCreationBytecode(template.beaconAddress, bytes(""), owner);
        return Create2.computeAddress(actualSalt, keccak256(bytecode), address(this));
    }

    function getDeployedContracts(uint256 page, uint256 pageSize)
        external
        view
        override
        returns (address[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert IContractsRegistryErrors.PageSizeTooLarge();
        if (pageSize == 0) revert IContractsRegistryErrors.PageSizeZero();
        if (page == 0) revert IContractsRegistryErrors.PageZero();
        return deployedContracts.paginate(page, pageSize);
    }

    function getDeployedContractsCount() external view override returns (uint256) {
        return deployedContracts.length;
    }

    function isContractDeployed(address contractAddress) external view override returns (bool) {
        return deployments[contractAddress].deployer != address(0);
    }

    function getProxiesByDID(string calldata deployerDID) external view override returns (address[] memory) {
        return didToProxies[deployerDID];
    }

    function getContractsByTemplate(bytes32 templateId, uint256 page, uint256 pageSize)
        external
        view
        override
        returns (address[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert IContractsRegistryErrors.PageSizeTooLarge();
        if (pageSize == 0) revert IContractsRegistryErrors.PageSizeZero();
        if (page == 0) revert IContractsRegistryErrors.PageZero();
        return templateToProxies[templateId].paginate(page, pageSize);
    }

    // Getters for private variables
    function getDeploymentInfo(address contractAddress) external view override returns (DeploymentInfo memory) {
        return deployments[contractAddress];
    }

    function getProxiesByDIDCount(string calldata deployerDID) external view override returns (uint256) {
        return didToProxies[deployerDID].length;
    }

    function getProxiesByDIDAtIndex(string calldata deployerDID, uint256 index)
        external
        view
        override
        returns (address)
    {
        if (index >= didToProxies[deployerDID].length) {
            revert IProxyFactory.IndexOutOfBounds();
        }
        return didToProxies[deployerDID][index];
    }

    // Note: Logic contracts ownership is managed by EBSI Governance
    // This contract only manages proxy deployments and upgrades

    function _loadActiveTemplate(string calldata templateName, string calldata templateVersion)
        internal
        view
        returns (bytes32 templateId, IProxyTemplatesRegistry.ProxyTemplate memory template)
    {
        if (bytes(templateName).length == 0) {
            revert IProxyFactory.TemplateNameRequired();
        }
        if (bytes(templateVersion).length == 0) {
            revert IProxyFactory.TemplateVersionRequired();
        }

        templateId = proxyTemplatesRegistry.computeTemplateId(templateName, templateVersion);
        template = proxyTemplatesRegistry.getTemplate(templateId);
        if (template.beaconAddress == address(0)) {
            revert IProxyFactory.TemplateNotFound();
        }
        if (!template.isActive) revert IProxyFactory.TemplateNotActive();
    }

    /**
     * @dev Prefer the live initializer selector advertised by the beacon
     *      implementation via {IImplementationInitSelector}; fall back to the
     *      template-stored selector when the impl is not ERC-165 aware.
     */
    function _resolveInitSelector(IProxyTemplatesRegistry.ProxyTemplate memory template)
        internal
        view
        returns (bytes4 initSelector)
    {
        address implementation = IBeacon(template.beaconAddress).implementation();
        bytes4 interfaceId = IImplementationInitSelector.getImplementationInitSelector.selector;

        try IERC165(implementation).supportsInterface(interfaceId) returns (bool supported) {
            if (supported) {
                initSelector = IImplementationInitSelector(implementation).getImplementationInitSelector();
                if (initSelector == bytes4(0)) {
                    revert IProxyFactory.ImplementationInitSelectorIsZero();
                }
                return initSelector;
            }
        } catch {}
        initSelector = template.initSelector;
        if (initSelector == bytes4(0)) {
            revert IProxyFactory.TemplateInitSelectorIsZero();
        }
    }

    function _prepareFinalInitData(bytes calldata initData, IProxyTemplatesRegistry.ProxyTemplate memory template)
        internal
        view
        returns (bytes memory finalInitData)
    {
        bytes4 initSelector = _resolveInitSelector(template);

        if (initData.length >= 4) {
            bytes4 dataSelector = bytes4(initData[:4]);
            if (dataSelector != initSelector) {
                finalInitData = abi.encodePacked(initSelector, initData);
            } else {
                finalInitData = initData;
            }
        } else {
            finalInitData = abi.encodePacked(initSelector, initData);
        }
    }

    /// @dev CREATE2 salt is independent of the live beacon init selector.
    ///      `deployer` is `msg.sender` on {deployProxyWithSalt} and the
    ///      explicit argument on {computeAddress}.
    function _create2Salt(bytes calldata initData, bytes32 salt, address deployer) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(initData, salt, deployer));
    }

    function _beaconProxyCreationBytecode(address beacon, bytes memory finalInitData, address owner)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(type(VersionedBeaconProxy).creationCode, abi.encode(beacon, finalInitData, owner));
    }

    function _registerDeployedProxy(
        bytes32 templateId,
        address proxyAddress,
        string calldata deployerDID,
        bytes memory finalInitData,
        address owner
    ) internal {
        string memory deployerDIDorParent = deployerDID;
        if (bytes(deployerDID).length == 0) {
            if (hasRole(EBSI_GOVERNOR, msg.sender)) {
                deployerDIDorParent = "";
            } else {
                // DID is copied from the parent; isActive is not.
                deployerDIDorParent = deployments[msg.sender].deployerDID;
            }
        }
        // EOA / governor deploys start active. Nested deploys (caller is a
        // registered proxy) start inactive; the governor must opt them in.
        bool isActive = deployments[msg.sender].deployer == address(0);
        deployments[proxyAddress] = DeploymentInfo({
            templateId: templateId,
            deployer: msg.sender,
            deploymentTimestamp: block.timestamp,
            isActive: isActive,
            deployerDID: deployerDIDorParent,
            owner: owner
        });

        deployedContracts.push(proxyAddress);
        didToProxies[deployerDIDorParent].push(proxyAddress);
        templateToProxies[templateId].push(proxyAddress);

        emit ProxyDeployed(
            proxyAddress, templateId, msg.sender, owner, deployerDIDorParent, finalInitData, block.timestamp
        );
    }
}
