// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title EBSIContracts
 * @author FIIT STU Team
 * @notice Configuration struct for EBSI contracts deployment
 */
struct EBSIContracts {
    address policyRegistry;
    address didRegistry;
    address proxyTemplateRegistry;
    address proxyFactory;
    address issuersRegistry;
    address schemasRegistry;
    address timestamp;
}

/**
 * @title EBSIConfig
 * @author FII STU Team
 * @notice Configuration struct for EBSI deployment
 */
struct EBSIConfig {
    bool deployEBSI; // Deploy new EBSI or connect to existing
    EBSIContracts existing; // The existing contracts; every address required if deployEBSI=false
    string entityRegistryDID; // DID for EntityRegistry
}
