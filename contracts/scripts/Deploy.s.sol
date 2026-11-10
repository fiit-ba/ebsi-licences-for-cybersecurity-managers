// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {VersionedUpgradeableBeacon} from "ebsi-mock/beacon-proxy/VersionedUpgradeableBeacon.sol";
import {IProxyTemplatesRegistry} from "ebsi-mock/contract-factory/interfaces/IProxyTemplatesRegistry.sol";
import {IProxyFactory} from "ebsi-mock/contract-factory/interfaces/IProxyFactory.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {Networks} from "./Networks.sol";
import {EBSIContracts} from "./DeployTypes.sol";

/**
 * Deploy the certificate registry and the governance contract (D39) to the
 * local Besu QBFT network.
 *
 * This is a pilot deployment path, not the EBSI one. EBSI is permissioned and
 * contracts are deployed through the Smart Contracts Factory from pre-approved
 * templates only (component 10.0). Getting this onto EBSI means proposing it
 * as a template first: Design -> Submit -> Deploy -> Grant Access, plus the
 * corresponding policy in the Trusted Policies Registry.
 *
 * Usage:
 *   npm run deploy:besu
 *   forge script scripts/Deploy.s.sol --rpc-url <url> --broadcast
 *
 * Environment:
 *   GOVERNANCE_DEPLOYER_KEY         pays for the deployment; default dev key 0
 *   GOVERNANCE_TAO                  the contract's owner; default dev key 4 on a dev
 *                                   chain (Networks.sol), else required
 *   GOVERNANCE_TAO_KEY              links the two contracts as the owner; default dev
 *                                   key 4 on a dev chain, else required
 *   GOVERNANCE_TAO_DID              the TAO's DID in the Trusted Issuers Registry;
 *                                   default a placeholder on a dev chain, else required
 *   GOVERNANCE_BEACON_OWNER         who can add beacon versions / opt the proxy into
 *                                   one; default the deployer on a dev chain, else
 *                                   required (TODO-v3.md O1)
 *   GOVERNANCE_STORAGE_LAYOUT_HASH  storage layout hash for VersionedUpgradeableBeacon
 *                                   (`forge inspect ...storageLayout`); default a hash
 *                                   of the implementation's code on a dev chain
 *   REGISTRY_STORAGE_LAYOUT_HASH    the same for the certificate registry
 *   GOVERNANCE_TEMPLATE_VERSION     Proxy Templates Registry version, default "1";
 *                                   bump to re-register under the same name
 *   GOVERNANCE_DEPLOYER_DID         deployer's DID for the Proxy Factory; empty by
 *                                   default (fine if the deployer holds EBSI_GOVERNOR)
 *
 * Deployed through EBSI's Smart Contracts Factory (component 10.0,
 * local/ebsi-mock/contract-factory), not directly: implementation,
 * VersionedUpgradeableBeacon, a template registered for them, then a proxy from that
 * template via the Proxy Factory (which also runs its initializer). The proxy is the
 * contract's address. The registry goes first: governance is initialized with its
 * address, and the TAO then points the registry at governance.
 *
 * The EBSI mock infrastructure (Proxy Templates Registry, Proxy Factory) must already
 * be deployed; this only reads it from deployments/<network>-ebsi.json, never deploys
 * it - `forge script --broadcast` runs run() twice (simulate, then real), so a decision
 * made here from whether that file exists would see its own first pass's file in its
 * second. `make deploy-anvil`/`deploy-besu` depend on their `deploy-ebsi-*` target for
 * this; that target redeploys when the record's address has no code on chain (not just
 * when the file is missing), since anvil resets between sessions.
 *
 * TIs come after, one contract for all of them: scripts/AddTi.s.sol.
 *
 * The deployer needs EBSI_GOVERNOR on both EBSI mocks (granted by default to whoever
 * deploys them), or addTemplate/deployProxy fall back to Policies Registry + DID checks.
 */
contract Deploy is Script, Networks {
    /// Template name on the Proxy Templates Registry; GOVERNANCE_TEMPLATE_VERSION
    /// names the version.
    string internal constant GOVERNANCE_TEMPLATE_NAME = "CertificateGovernance";
    string internal constant REGISTRY_TEMPLATE_NAME = "CertificateRegistry";

    // Set by run() for the deployment record.
    address internal implementationAddress;
    address internal beaconAddress;
    address internal beaconOwner;
    address internal tao;
    bytes32 internal storageLayoutHash;
    address internal registryImplementation;
    address internal registryBeacon;
    bytes32 internal registryStorageLayoutHash;
    EBSIContracts internal ebsi;
    string internal templateVersion;
    string internal taoDid;

    function run() external returns (CertificateGovernance governance) {
        bool development = _isDevelopment();
        uint256 deployerKey = _deployerKey(development);

        console.log("network      :", _networkName());
        console.log("deployer     :", vm.addr(deployerKey));

        beaconOwner = _beaconOwner(development, vm.addr(deployerKey));
        console.log("beacon owner :", beaconOwner);
        tao = _tao(development);
        console.log("owner (TAO)  :", tao);
        taoDid = development ? vm.envOr("GOVERNANCE_TAO_DID", string("did:ebsi:zDevelopmentTao")) : vm.envString("GOVERNANCE_TAO_DID");
        console.log("TAO DID      :", taoDid);

        ebsi = _ebsiInfra();
        console.log("EBSI templates registry:", ebsi.proxyTemplateRegistry);
        console.log("EBSI proxy factory      :", ebsi.proxyFactory);
        templateVersion = vm.envOr("GOVERNANCE_TEMPLATE_VERSION", string("1"));
        string memory deployerDID = vm.envOr("GOVERNANCE_DEPLOYER_DID", string(""));

        uint256 taoKey = _taoKey(development);

        vm.startBroadcast(deployerKey);
        registryImplementation = address(new CertificateRegistry());
        registryStorageLayoutHash = _storageLayoutHash(development, "REGISTRY_STORAGE_LAYOUT_HASH", registryImplementation);
        registryBeacon = address(new VersionedUpgradeableBeacon(beaconOwner, registryImplementation, registryStorageLayoutHash));
        IProxyTemplatesRegistry(ebsi.proxyTemplateRegistry).addTemplate(
            IProxyTemplatesRegistry.ProxyTemplate({
                name: REGISTRY_TEMPLATE_NAME,
                version: templateVersion,
                beaconAddress: registryBeacon,
                repoURI: "n/a: local deployment, not yet submitted to EBSI",
                auditURI: "n/a: local deployment, not yet submitted to EBSI",
                initSelector: CertificateRegistry.initialize.selector,
                isActive: true // addTemplate sets this itself regardless
            })
        );
        CertificateRegistry registry = CertificateRegistry(
            IProxyFactory(ebsi.proxyFactory).deployProxy(
                REGISTRY_TEMPLATE_NAME, templateVersion, abi.encodeCall(CertificateRegistry.initialize, (tao)), deployerDID, beaconOwner
            )
        );

        implementationAddress = address(new CertificateGovernance());
        storageLayoutHash = _storageLayoutHash(development, "GOVERNANCE_STORAGE_LAYOUT_HASH", implementationAddress);
        beaconAddress = address(new VersionedUpgradeableBeacon(beaconOwner, implementationAddress, storageLayoutHash));

        IProxyTemplatesRegistry(ebsi.proxyTemplateRegistry).addTemplate(
            IProxyTemplatesRegistry.ProxyTemplate({
                name: GOVERNANCE_TEMPLATE_NAME,
                version: templateVersion,
                beaconAddress: beaconAddress,
                repoURI: "n/a: local deployment, not yet submitted to EBSI",
                auditURI: "n/a: local deployment, not yet submitted to EBSI",
                initSelector: CertificateGovernance.initialize.selector,
                isActive: true // addTemplate sets this itself regardless
            })
        );

        bytes memory init = abi.encodeCall(
            CertificateGovernance.initialize,
            (tao, taoDid, ebsi.didRegistry, ebsi.issuersRegistry, address(registry))
        );
        // The proxy owner is the beacon owner too: the only proxy on its beacon.
        governance = CertificateGovernance(
            IProxyFactory(ebsi.proxyFactory).deployProxy(GOVERNANCE_TEMPLATE_NAME, templateVersion, init, deployerDID, beaconOwner)
        );
        vm.stopBroadcast();

        vm.broadcast(taoKey);
        registry.setGovernance(address(governance));

        console.log("\nCertificateRegistry        :", address(registry));
        console.log("  implementation          :", registryImplementation);
        console.log("  beacon                  :", registryBeacon);
        console.log("CertificateGovernance      :", address(governance));
        console.log("  implementation          :", implementationAddress);
        console.log("  beacon                  :", beaconAddress);
        console.log("  storage layout hash     :", vm.toString(storageLayoutHash));
        console.log("  template                :", string.concat(GOVERNANCE_TEMPLATE_NAME, " ", templateVersion));

        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) {
            console.log("\nA dry run (no --broadcast): no deployment record written.");
            return governance;
        }
        _writeRecord(governance, registry);

        console.log("\nNext: set up each TI (scripts/AddTi.s.sol), then point the back-office, its");
        console.log("console and the wallet at the contracts.");
        console.log(string.concat("  PLR_GOVERNANCE_CONTRACT=", vm.toString(address(governance)), "   (infra/.env)"));
        console.log(string.concat("  PLR_CERTIFICATE_REGISTRY=", vm.toString(address(registry)), "  (infra/.env)"));
        console.log(string.concat("  CERTIFICATE_REGISTRY=", vm.toString(address(registry)), "      (holder-wallet/.env)"));
        console.log("\nThe back-office records every collected certificate on it (its sweep), and");
        console.log("watches ProposalExecuted to bring its own cases up to the contract (D36).");
    }

    /// Whoever holds the beacon can change every rule, so off a development
    /// chain it is named, and never a development account.
    function _beaconOwner(bool development, address deployer) internal view returns (address owner) {
        if (development) return vm.envOr("GOVERNANCE_BEACON_OWNER", deployer);
        owner = vm.envAddress("GOVERNANCE_BEACON_OWNER");
        require(
            !_isDevelopmentAccount(owner),
            string.concat("The beacon owner is a public development account; it cannot own it on ", _networkName())
        );
    }

    /// Named off a development chain, and never a development account.
    function _tao(bool development) internal view returns (address owner) {
        if (development) return vm.envOr("GOVERNANCE_TAO", _developmentAccount(DEVELOPMENT_TAO));
        owner = vm.envAddress("GOVERNANCE_TAO");
        require(
            !_isDevelopmentAccount(owner),
            string.concat("The TAO is a public development account; it cannot own the contract on ", _networkName())
        );
    }

    /// The owner links the contracts, so its key has to be at hand.
    function _taoKey(bool development) internal view returns (uint256 key) {
        key = development ? vm.envOr("GOVERNANCE_TAO_KEY", _developmentKey(DEVELOPMENT_TAO)) : vm.envUint("GOVERNANCE_TAO_KEY");
        require(vm.addr(key) == tao, "GOVERNANCE_TAO_KEY is not the key of GOVERNANCE_TAO");
    }

    /// Storage layout fingerprint for VersionedUpgradeableBeacon. Named off a dev
    /// chain (from the real compiler output); on a dev chain, a hash of the
    /// implementation's code instead (changes every rebuild, not just on a real
    /// storage change, but there's no upgrade history worth protecting there).
    function _storageLayoutHash(bool development, string memory name, address implementation)
        internal
        view
        returns (bytes32)
    {
        if (development) return vm.envOr(name, keccak256(implementation.code));
        return vm.envBytes32(name);
    }

    /// The EBSI mock infra's Proxy Templates Registry and Proxy Factory, read
    /// from deployments/<network>-ebsi.json. Never deployed here - see the
    /// header comment on forge's two-pass --broadcast.
    function _ebsiInfra() internal view returns (EBSIContracts memory infra) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", _networkName(), "-ebsi.json");
        require(
            vm.isFile(path),
            string.concat(
                "No ", path, ": deploy the EBSI mock infrastructure first (make deploy-ebsi-", _networkName(), ")"
            )
        );
        string memory json = vm.readFile(path);
        infra.policyRegistry = vm.parseJsonAddress(json, ".ebsi.PolicyRegistry.contractAddress");
        infra.didRegistry = vm.parseJsonAddress(json, ".ebsi.DidRegistry.contractAddress");
        infra.proxyTemplateRegistry = vm.parseJsonAddress(json, ".ebsi.ProxyTemplateRegistry.contractAddress");
        infra.proxyFactory = vm.parseJsonAddress(json, ".ebsi.ProxyFactory.contractAddress");
        infra.issuersRegistry = vm.parseJsonAddress(json, ".ebsi.IssuersRegistry.contractAddress");
        infra.schemasRegistry = vm.parseJsonAddress(json, ".ebsi.SchemasRegistry.contractAddress");
        infra.timestamp = vm.parseJsonAddress(json, ".ebsi.Timestamp.contractAddress");
        console.log("EBSI infra   : loaded from", path);
    }

    function _deployerKey(bool development) internal view returns (uint256) {
        if (development) return vm.envOr("GOVERNANCE_DEPLOYER_KEY", _developmentKey(DEVELOPMENT_DEPLOYER));
        // The deployer only pays; the signers are named by address above.
        return vm.envUint("GOVERNANCE_DEPLOYER_KEY");
    }

    function _writeRecord(CertificateGovernance governance, CertificateRegistry registry) internal {
        vm.serializeAddress("governance", "address", address(governance));
        vm.serializeAddress("governance", "implementation", implementationAddress);
        vm.serializeAddress("governance", "beacon", beaconAddress);
        vm.serializeAddress("governance", "beaconOwner", beaconOwner);
        vm.serializeAddress("governance", "owner", tao);
        vm.serializeString("governance", "taoDid", taoDid);
        vm.serializeAddress("governance", "didRegistry", ebsi.didRegistry);
        vm.serializeAddress("governance", "issuersRegistry", ebsi.issuersRegistry);
        vm.serializeBytes32("governance", "storageLayoutHash", storageLayoutHash);
        vm.serializeString("governance", "templateName", GOVERNANCE_TEMPLATE_NAME);
        vm.serializeString("governance", "templateVersion", templateVersion);
        vm.serializeAddress("governance", "proxyTemplateRegistry", ebsi.proxyTemplateRegistry);
        string memory governanceJson = vm.serializeAddress("governance", "proxyFactory", ebsi.proxyFactory);

        vm.serializeAddress("registry", "address", address(registry));
        vm.serializeAddress("registry", "implementation", registryImplementation);
        vm.serializeAddress("registry", "beacon", registryBeacon);
        vm.serializeBytes32("registry", "storageLayoutHash", registryStorageLayoutHash);
        vm.serializeString("registry", "templateVersion", templateVersion);
        string memory registryJson = vm.serializeString("registry", "templateName", REGISTRY_TEMPLATE_NAME);

        vm.serializeString("record", "network", _networkName());
        vm.serializeUint("record", "chainId", block.chainid);
        vm.serializeUint("record", "deployedAt", vm.unixTime() / 1000);
        vm.serializeString("record", "CertificateRegistry", registryJson);
        string memory record = vm.serializeString("record", "CertificateGovernance", governanceJson);

        vm.createDir(string.concat(vm.projectRoot(), "/deployments"), true);
        string memory file = _recordFile();
        vm.writeJson(record, file);
        console.log("\nDeployment record written to", file);
    }
}
