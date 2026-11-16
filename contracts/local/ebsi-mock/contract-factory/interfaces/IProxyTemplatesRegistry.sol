// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import {IContractsRegistryErrors} from "./IContractsRegistryErrors.sol";

interface IProxyTemplatesRegistry is IContractsRegistryErrors {
    // --- Errors ---
    error NotAuthorizedToManageTemplates();
    error TemplateNameCannotBeEmpty();
    error TemplateVersionCannotBeEmpty();
    error BeaconAddressCannotBeZero();
    error BeaconImplementationCannotBeZero();
    error InvalidUpgradeableBeacon();
    error RepositoryURICannotBeEmpty();
    error AuditURICannotBeEmpty();
    error TemplateAlreadyExists();
    error TemplateDoesNotExist();
    error TemplateAlreadyDeprecated();
    error InitSelectorCannotBeZero();

    struct ProxyTemplate {
        string name;
        string version;
        address beaconAddress; // Points to logic contract
        string repoURI; // Source code repo
        string auditURI; // Link to audit report
        bytes4 initSelector; // Function selector for `initialize(...)`
        bool isActive;
    }

    event TemplateAdded(
        bytes32 indexed templateId,
        address indexed beaconAddress,
        string name,
        string version,
        string repoURI,
        string auditURI,
        bytes4 initSelector
    );
    event TemplateDeprecated(bytes32 indexed templateId);
    event TemplateMetadataUpdated(
        bytes32 indexed templateId,
        string oldRepoURI,
        string newRepoURI,
        string oldAuditURI,
        string newAuditURI,
        bytes4 oldInitSelector,
        bytes4 newInitSelector
    );

    event PoliciesRegistrySet(address indexed policiesRegistry);

    function setPoliciesRegistry(address _policiesRegistry) external;

    function addTemplate(ProxyTemplate calldata newTemplate) external;
    function deprecateTemplate(bytes32 templateId) external;
    function updateTemplateMetadata(
        bytes32 templateId,
        string calldata repoURI,
        string calldata auditURI,
        bytes4 initSelector
    ) external;

    function getTemplate(bytes32 templateId) external view returns (ProxyTemplate memory);
    function computeTemplateId(string calldata name, string calldata version) external pure returns (bytes32);
}
