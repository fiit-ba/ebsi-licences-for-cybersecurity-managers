// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Networks} from "./Networks.sol";
import {EBSIContracts, EBSIConfig} from "./DeployTypes.sol";

// EBSI Contracts
import {PoliciesRegistry as PolicyRegistry} from "ebsi-mock/policies-registry/PolicyRegistry.sol";
import {DidRegistry} from "ebsi-mock/did-registry/DidRegistry.sol";
import {IssuersRegistry} from "ebsi-mock/issuers-registry/IssuersRegistry.sol";
import {SchemasRegistry} from "ebsi-mock/schemas-registry/SchemasRegistry.sol";
import {Timestamp} from "ebsi-mock/timestamp/Timestamp.sol";
import {ProxyTemplatesRegistry as ProxyTemplateRegistry} from "ebsi-mock/contract-factory/ProxyTemplateRegistry.sol";
import {ProxyFactory} from "ebsi-mock/contract-factory/ProxyFactory.sol";

/**
 * @title SetupEBSIInfrastructure
 * @author FIIT STU Team
 * @notice Comprehensive EBSI infrastructure setup (deployment and integration)
 * @dev Handles setup (deployment, configuration, and integration) of the EBSI mock contracts
 *      (local/ebsi-mock) on a development chain, where EBSI's own registries do not exist.
 *
 *      Each mock is an upgradeable implementation whose constructor disables its initializer,
 *      as on EBSI. It is deployed here behind an ERC1967Proxy that calls `initialize` on
 *      creation; EBSI itself runs them behind its versioned beacons (beacon-proxy/), which
 *      the governance contract does not depend on.
 *
 *      Environment:
 *        DEPLOY_EBSI              deploy the mocks (default true), or load existing addresses
 *        GOVERNANCE_DEPLOYER_KEY  the deployer; on a development chain the first development key
 *        EBSI_ADMIN               admin of the Policies Registry and both factory contracts
 *                                 (default: the deployer)
 *        EBSI_OPERATOR            the Policies Registry's operator (default: the deployer)
 *        EBSI_GOVERNOR            the factory contracts' EBSI governor (default: the deployer)
 */
contract SetupEBSIInfrastructure is Script, Networks {
    // solhint-disable private-vars-leading-underscore, ordering

    /// @param variable The environment variable that names the missing address.
    error DeployConfig__EBSIAddressNotSet(string variable);

    /*//////////////////////////////////////////////////////////////
                         EBSI CORE DEPLOYMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Main entry point for EBSI setup - handles conditional deployment
     * @return ebsi Struct containing all EBSI contract addresses
     */
    function setupEBSI() public returns (EBSIContracts memory ebsi) {
        EBSIConfig memory config = getEBSIConfig();

        console2.log("=== EBSI Setup ===");
        console2.log("Deploy EBSI Infrastructure:", config.deployEBSI);

        // Step 1: Deploy or load EBSI infrastructure
        if (config.deployEBSI) {
            ebsi = _deployEBSIInfrastructure();
        } else {
            ebsi = _loadExistingEBSIInfrastructure(config);
        }

        console2.log("=== Deploy EBSI Complete ===");
        return ebsi;
    }

    /**
     * @notice Deploy complete EBSI infrastructure (PolicyRegistry, DidRegistry, etc.)
     * @dev Order follows the dependencies: the Policies Registry first, which the DID Registry,
     *      the Trusted Issuers Registry and the Proxy Templates Registry read; then the
     *      Proxy Factory, which reads the templates.
     * @return ebsi Struct with deployed contract addresses
     */
    function _deployEBSIInfrastructure() internal returns (EBSIContracts memory ebsi) {
        console2.log("Deploying EBSI Infrastructure...");

        uint256 deployerKey = _ebsiDeployerKey();
        address deployer = vm.addr(deployerKey);
        address admin = vm.envOr("EBSI_ADMIN", deployer);
        address operator = vm.envOr("EBSI_OPERATOR", deployer);
        address governor = vm.envOr("EBSI_GOVERNOR", deployer);

        vm.startBroadcast(deployerKey);
        ebsi.policyRegistry = _deployPolicyRegistry(admin, operator);
        ebsi.didRegistry = _deployDidRegistry(ebsi.policyRegistry);
        ebsi.issuersRegistry = _deployIssuersRegistry(ebsi.policyRegistry, ebsi.didRegistry);
        ebsi.schemasRegistry = _deploySchemasRegistry(ebsi.policyRegistry);
        ebsi.timestamp = _deployTimestamp(ebsi.policyRegistry);
        ebsi.proxyTemplateRegistry = _deployProxyTemplateRegistry(ebsi.policyRegistry, admin, governor);
        ebsi.proxyFactory = _deployProxyFactory(ebsi.proxyTemplateRegistry, admin, governor);
        vm.stopBroadcast();

        console2.log(" - PolicyRegistry:", ebsi.policyRegistry);
        console2.log(" - DidRegistry:", ebsi.didRegistry);
        console2.log(" - ProxyTemplateRegistry:", ebsi.proxyTemplateRegistry);
        console2.log(" - ProxyFactory:", ebsi.proxyFactory);
        console2.log(" - IssuersRegistry:", ebsi.issuersRegistry);
        console2.log(" - SchemasRegistry:", ebsi.schemasRegistry);
        console2.log(" - Timestamp:", ebsi.timestamp);

        return ebsi;
    }

    /*//////////////////////////////////////////////////////////////
                      EBSI COMPONENT DEPLOYMENT
    //////////////////////////////////////////////////////////////*/

    // Each returns the proxy's address and runs inside the caller's broadcast.

    /**
     * @notice Deploy the Policies Registry
     * @param admin Holder of its admin role
     * @param operator Holder of its operator role
     */
    function _deployPolicyRegistry(address admin, address operator) private returns (address) {
        return _proxy(address(new PolicyRegistry()), abi.encodeCall(PolicyRegistry.initialize, (admin, operator)));
    }

    /**
     * @notice Deploy the DID Registry
     * @param policyRegistry_ Address of the Policies Registry
     */
    function _deployDidRegistry(address policyRegistry_) private returns (address) {
        return _proxy(address(new DidRegistry()), abi.encodeCall(DidRegistry.initialize, (policyRegistry_)));
    }

    /**
     * @notice Deploy the Trusted Issuers Registry
     * @param policyRegistry_ Address of the Policies Registry
     * @param didRegistry_ Address of the DID Registry
     */
    function _deployIssuersRegistry(address policyRegistry_, address didRegistry_) private returns (address) {
        return _proxy(
            address(new IssuersRegistry()), abi.encodeCall(IssuersRegistry.initialize, (policyRegistry_, didRegistry_))
        );
    }

    /**
     * @notice Deploy the Trusted Schemas Registry
     * @param policyRegistry_ Address of the Policies Registry
     */
    function _deploySchemasRegistry(address policyRegistry_) private returns (address) {
        return _proxy(address(new SchemasRegistry()), abi.encodeCall(SchemasRegistry.initialize, (policyRegistry_)));
    }

    /**
     * @notice Deploy the Timestamp contract
     * @param policyRegistry_ Address of the Policies Registry
     */
    function _deployTimestamp(address policyRegistry_) private returns (address) {
        return _proxy(address(new Timestamp()), abi.encodeCall(Timestamp.initialize, (policyRegistry_)));
    }

    /**
     * @notice Deploy the Proxy Templates Registry
     * @param policyRegistry_ Address of the Policies Registry
     * @param admin Holder of its default admin role
     * @param governor The EBSI governor
     */
    function _deployProxyTemplateRegistry(address policyRegistry_, address admin, address governor)
        private
        returns (address)
    {
        return _proxy(
            address(new ProxyTemplateRegistry()),
            abi.encodeCall(ProxyTemplateRegistry.initialize, (policyRegistry_, admin, governor))
        );
    }

    /**
     * @notice Deploy the Proxy Factory
     * @param templateRegistry Address of the Proxy Templates Registry
     * @param admin Holder of its default admin role
     * @param governor The EBSI governor
     */
    function _deployProxyFactory(address templateRegistry, address admin, address governor) private returns (address) {
        return _proxy(
            address(new ProxyFactory()), abi.encodeCall(ProxyFactory.initialize, (templateRegistry, admin, governor))
        );
    }

    /// @dev An ERC1967Proxy in front of `impl`, initialized in the same transaction, so no one
    ///      can initialize it first.
    function _proxy(address impl, bytes memory initData) private returns (address) {
        return address(new ERC1967Proxy(impl, initData));
    }

    /// @dev The deployer's key: GOVERNANCE_DEPLOYER_KEY, or on a development chain the first
    ///      development key, as for the governance contract (Deploy.s.sol).
    function _ebsiDeployerKey() internal view returns (uint256) {
        if (_isDevelopment()) return vm.envOr("GOVERNANCE_DEPLOYER_KEY", _developmentKey(0));
        return vm.envUint("GOVERNANCE_DEPLOYER_KEY");
    }

    /**
     * @notice Get EBSI configuration from environment variables
     * @return config EBSIConfig struct with deployment settings
     * @dev if deployEBSI is false, every address of `existing` is required (EBSI_POLICY_REGISTRY,
     *      EBSI_DID_REGISTRY, EBSI_PROXY_REGISTRY, EBSI_PROXY_FACTORY, EBSI_ISSUERS_REGISTRY,
     *      EBSI_SCHEMAS_REGISTRY, EBSI_TIMESTAMP)
     * @dev if deployEBSI is true, all addresses are set to zero as their deployment is handled afterwards
     */
    function getEBSIConfig() public view returns (EBSIConfig memory config) {
        config.deployEBSI = vm.envOr("DEPLOY_EBSI", true);
        config.entityRegistryDID = vm.envOr("EBSI_DID_ENTITY_REGISTRY", string(""));

        if (!config.deployEBSI) {
            // Connect to existing EBSI - all addresses required
            config.existing = EBSIContracts({
                policyRegistry: _requiredAddress("EBSI_POLICY_REGISTRY"),
                didRegistry: _requiredAddress("EBSI_DID_REGISTRY"),
                proxyTemplateRegistry: _requiredAddress("EBSI_PROXY_REGISTRY"),
                proxyFactory: _requiredAddress("EBSI_PROXY_FACTORY"),
                issuersRegistry: _requiredAddress("EBSI_ISSUERS_REGISTRY"),
                schemasRegistry: _requiredAddress("EBSI_SCHEMAS_REGISTRY"),
                timestamp: _requiredAddress("EBSI_TIMESTAMP")
            });
        }
    }

    /// @dev The address in environment variable `variable`; reverts when it is unset or zero.
    function _requiredAddress(string memory variable) private view returns (address value) {
        value = vm.envOr(variable, address(0));
        if (value == address(0)) revert DeployConfig__EBSIAddressNotSet(variable);
    }

    /*//////////////////////////////////////////////////////////////
                         INTERNAL PURE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Load addresses of existing EBSI infrastructure
     * @param config EBSI configuration with addresses
     * @return ebsi Struct with existing contract addresses
     */
    function _loadExistingEBSIInfrastructure(EBSIConfig memory config)
        internal
        pure
        returns (EBSIContracts memory ebsi)
    {
        console2.log("Loading EBSI infra...");
        ebsi = config.existing;

        console2.log(" - PolicyRegistry:", ebsi.policyRegistry);
        console2.log(" - DidRegistry:", ebsi.didRegistry);
        console2.log(" - ProxyTemplateRegistry:", ebsi.proxyTemplateRegistry);
        console2.log(" - ProxyFactory:", ebsi.proxyFactory);
        console2.log(" - IssuersRegistry:", ebsi.issuersRegistry);
        console2.log(" - SchemasRegistry:", ebsi.schemasRegistry);
        console2.log(" - Timestamp:", ebsi.timestamp);

        return ebsi;
    }

    /*//////////////////////////////////////////////////////////////
                    JSON SERIALIZATION (for standalone use)
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Serialize EBSI contracts to JSON string
     * @param ebsi EBSI contracts struct
     * @return JSON string representation of EBSI contracts
     */
    function serializeEBSI(EBSIContracts memory ebsi) public returns (string memory) {
        string memory didRegistryJson = vm.serializeAddress("DidRegistry", "contractAddress", ebsi.didRegistry);

        string memory proxyTemplateRegistryJson =
            vm.serializeAddress("ProxyTemplateRegistry", "contractAddress", ebsi.proxyTemplateRegistry);

        string memory proxyFactoryJson = vm.serializeAddress("ProxyFactory", "contractAddress", ebsi.proxyFactory);

        string memory policyRegistryJson = vm.serializeAddress("PolicyRegistry", "contractAddress", ebsi.policyRegistry);
        string memory issuersRegistryJson =
            vm.serializeAddress("IssuersRegistry", "contractAddress", ebsi.issuersRegistry);

        string memory ebsiJson = vm.serializeString("ebsi", "DidRegistry", didRegistryJson);
        ebsiJson = vm.serializeString("ebsi", "ProxyTemplateRegistry", proxyTemplateRegistryJson);
        ebsiJson = vm.serializeString("ebsi", "ProxyFactory", proxyFactoryJson);
        ebsiJson = vm.serializeString("ebsi", "PolicyRegistry", policyRegistryJson);
        ebsiJson = vm.serializeString("ebsi", "IssuersRegistry", issuersRegistryJson);
        ebsiJson = vm.serializeString(
            "ebsi", "SchemasRegistry", vm.serializeAddress("SchemasRegistry", "contractAddress", ebsi.schemasRegistry)
        );
        ebsiJson = vm.serializeString(
            "ebsi", "Timestamp", vm.serializeAddress("Timestamp", "contractAddress", ebsi.timestamp)
        );

        return ebsiJson;
    }

    /**
     * @notice Save EBSI deployment to JSON file (for standalone EBSI deployment)
     * @param ebsi EBSI contracts struct
     */
    function saveEBSIDeploymentToJson(EBSIContracts memory ebsi) internal {
        if (!_shouldPersistDeploymentArtifacts()) {
            return;
        }

        console2.log(" - Saving EBSI JSON");

        string memory ebsiJson = serializeEBSI(ebsi);
        string memory finalJson = vm.serializeString("deployment", "ebsi", ebsiJson);

        // deployments/<network>-ebsi.json, next to the governance contract's record.
        vm.createDir(string.concat(vm.projectRoot(), "/deployments"), true);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", _networkName(), "-ebsi.json");
        vm.writeJson(finalJson, path);
        console2.log(" - Written to", path);
    }

    /**
     * @notice Returns true only for broadcasted or resumed script execution.
     * @dev Forge may execute scripts in additional non-broadcast contexts while preparing or simulating a run.
     *      Persisting deployment JSON in those contexts can overwrite the real broadcast artifacts with addresses
     *      that were never deployed on-chain. Restricting writes to broadcast/resume contexts ensures `latest`
     *      deployment files are generated for local Anvil runs and other real deployments, while simulation-only
     *      passes cannot corrupt them.
     * @return shouldPersist Whether deployment files should be written for the current Forge context.
     */
    function _shouldPersistDeploymentArtifacts() internal view returns (bool shouldPersist) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }
}
