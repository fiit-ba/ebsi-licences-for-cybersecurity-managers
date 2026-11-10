// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import "./interfaces/IProxyTemplatesRegistry.sol";
import "./interfaces/IPoliciesRegistry.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./libraries/Pagination.sol";

contract ProxyTemplatesRegistry is
    IProxyTemplatesRegistry,
    Initializable,
    AccessControlUpgradeable,
    ImplementationInitSelector
{
    using Strings for string;
    using Pagination for bytes32[];

    // Policy names for EBSI ecosystem
    string public constant MANAGE_TEMPLATES_POLICY = "ProxyTemplatesRegistry:manageTemplates";

    bytes32 public constant EBSI_GOVERNOR = keccak256("EBSI_GOVERNOR");

    IPoliciesRegistry public policiesRegistry;

    mapping(bytes32 => ProxyTemplate) private templates;
    bytes32[] private templateIds;
    mapping(bytes32 => bool) private deprecatedTemplates;

    // Custom modifier to check authorization via the Policies Registry
    modifier isAuthorizedToManage() {
        if (!hasRole(EBSI_GOVERNOR, msg.sender)) {
            if (address(policiesRegistry) == address(0)) {
                revert IContractsRegistryErrors.PoliciesRegistryNotSet();
            }
            if (!policiesRegistry.checkPolicy(MANAGE_TEMPLATES_POLICY, msg.sender)) {
                revert IProxyTemplatesRegistry.NotAuthorizedToManageTemplates();
            }
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _policiesRegistry, address defaultAdmin, address ebsiGovernor) external initializer {
        __AccessControl_init();
        // Policies Registry may be unset at bootstrap: only the governor is
        // available until the Policies Registry (and DID Registry) are deployed and wired via setters.
        if (_policiesRegistry != address(0)) {
            if (_policiesRegistry.code.length == 0) {
                revert IContractsRegistryErrors.PoliciesRegistryNotAContract();
            }
            policiesRegistry = IPoliciesRegistry(_policiesRegistry);
            emit PoliciesRegistrySet(_policiesRegistry);
        }
        if (defaultAdmin == address(0)) {
            revert IContractsRegistryErrors.DefaultAdminCannotBeZero();
        }
        if (ebsiGovernor == address(0)) {
            revert IContractsRegistryErrors.EbsiGovernorCannotBeZero();
        }
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

    function addTemplate(ProxyTemplate calldata newTemplate) external override isAuthorizedToManage {
        if (bytes(newTemplate.name).length == 0) {
            revert IProxyTemplatesRegistry.TemplateNameCannotBeEmpty();
        }
        if (bytes(newTemplate.version).length == 0) {
            revert IProxyTemplatesRegistry.TemplateVersionCannotBeEmpty();
        }
        if (newTemplate.beaconAddress == address(0)) {
            revert IProxyTemplatesRegistry.BeaconAddressCannotBeZero();
        }

        // Validate that the beacon is actually an upgradeable beacon
        try IBeacon(newTemplate.beaconAddress).implementation() returns (address implementation) {
            if (implementation == address(0)) {
                revert IProxyTemplatesRegistry.BeaconImplementationCannotBeZero();
            }
        } catch {
            revert IProxyTemplatesRegistry.InvalidUpgradeableBeacon();
        }
        if (bytes(newTemplate.repoURI).length == 0) {
            revert IProxyTemplatesRegistry.RepositoryURICannotBeEmpty();
        }
        if (bytes(newTemplate.auditURI).length == 0) {
            revert IProxyTemplatesRegistry.AuditURICannotBeEmpty();
        }
        if (newTemplate.initSelector == bytes4(0)) {
            revert IProxyTemplatesRegistry.InitSelectorCannotBeZero();
        }

        bytes32 templateId = computeTemplateId(newTemplate.name, newTemplate.version);
        if (templates[templateId].beaconAddress != address(0)) {
            revert IProxyTemplatesRegistry.TemplateAlreadyExists();
        }

        // Create a memory copy since calldata structs are read-only
        ProxyTemplate memory template = newTemplate;
        template.isActive = true;
        templates[templateId] = template;
        templateIds.push(templateId);

        emit TemplateAdded(
            templateId,
            template.beaconAddress,
            template.name,
            template.version,
            template.repoURI,
            template.auditURI,
            template.initSelector
        );
    }

    function deprecateTemplate(bytes32 templateId) external override isAuthorizedToManage {
        if (templates[templateId].beaconAddress == address(0)) {
            revert IProxyTemplatesRegistry.TemplateDoesNotExist();
        }
        if (deprecatedTemplates[templateId]) {
            revert IProxyTemplatesRegistry.TemplateAlreadyDeprecated();
        }

        deprecatedTemplates[templateId] = true;
        templates[templateId].isActive = false;

        emit TemplateDeprecated(templateId);
    }

    function updateTemplateMetadata(
        bytes32 templateId,
        string calldata repoURI,
        string calldata auditURI,
        bytes4 initSelector
    ) external override isAuthorizedToManage {
        if (templates[templateId].beaconAddress == address(0)) {
            revert IProxyTemplatesRegistry.TemplateDoesNotExist();
        }
        if (bytes(repoURI).length == 0) {
            revert IProxyTemplatesRegistry.RepositoryURICannotBeEmpty();
        }
        if (bytes(auditURI).length == 0) {
            revert IProxyTemplatesRegistry.AuditURICannotBeEmpty();
        }
        if (initSelector == bytes4(0)) {
            revert IProxyTemplatesRegistry.InitSelectorCannotBeZero();
        }

        ProxyTemplate storage template = templates[templateId];
        string memory oldRepoURI = template.repoURI;
        string memory oldAuditURI = template.auditURI;
        bytes4 oldInitSelector = template.initSelector;

        template.repoURI = repoURI;
        template.auditURI = auditURI;
        template.initSelector = initSelector;

        emit TemplateMetadataUpdated(
            templateId, oldRepoURI, repoURI, oldAuditURI, auditURI, oldInitSelector, initSelector
        );
    }

    function getTemplate(bytes32 templateId) external view override returns (ProxyTemplate memory) {
        return templates[templateId];
    }

    function computeTemplateId(string calldata name, string calldata version) public pure override returns (bytes32) {
        return keccak256(abi.encode(name, version));
    }

    function getTemplateIds(uint256 page, uint256 pageSize)
        external
        view
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        if (pageSize > 50) revert IContractsRegistryErrors.PageSizeTooLarge();
        if (pageSize == 0) revert IContractsRegistryErrors.PageSizeZero();
        if (page == 0) revert IContractsRegistryErrors.PageZero();
        (items, total, howMany, prev, next) = templateIds.paginate(page, pageSize);
    }

    function isTemplateActive(bytes32 templateId) external view returns (bool) {
        return templates[templateId].isActive && !deprecatedTemplates[templateId];
    }

    function getTemplateCount() external view returns (uint256) {
        return templateIds.length;
    }

    // Only DEFAULT_ADMIN_ROLE can manage roles
    function grantRole(bytes32 role, address account) public override onlyRole(DEFAULT_ADMIN_ROLE) {
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyRole(DEFAULT_ADMIN_ROLE) {
        super.revokeRole(role, account);
    }

    // Note: Logic contracts ownership is managed by EBSI Governance
    // This contract only manages templates and their metadata
}
