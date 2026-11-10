// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoliciesRegistry} from "ebsi-mock/policies-registry/PolicyRegistry.sol";
import {DidRegistry} from "ebsi-mock/did-registry/DidRegistry.sol";
import {IssuersRegistry} from "ebsi-mock/issuers-registry/IssuersRegistry.sol";
import {IIssuersRegistry as TIR} from "ebsi-mock/issuers-registry/interfaces/IIssuersRegistry.sol";
import {Networks} from "./Networks.sol";

/**
 * Seed the EBSI mocks of a development chain for AddTi.s.sol: a RootTAO, the
 * TAO Deploy.s.sol defaults to, a TI with two keys, and NBÚ, each with the
 * development key Networks.sol names for it. Once per chain: a DID cannot be
 * inserted twice.
 *
 *   forge script scripts/SeedEbsi.s.sol --rpc-url <url> --broadcast --slow
 */
contract SeedEbsi is Script, Networks {
    string internal constant ROOT = "did:ebsi:zDevelopmentRoot";
    string internal constant TAO = "did:ebsi:zDevelopmentTao";
    string internal constant TI = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    string internal constant NBU = "did:ebsi:zDevelopmentNbu";
    string internal constant BOOTSTRAP_POLICY = "IssuersRegistry:setAttributeMetadata";
    bytes32 internal constant SALT = keccak256("development");
    /// What a key needs to pay for its transactions on a development chain.
    uint256 internal constant GAS_MONEY = 1 ether;

    function run() external {
        require(_isDevelopment(), "SeedEbsi uses the development keys: run it on a development chain.");
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/", _networkName(), "-ebsi.json"));
        PoliciesRegistry policies = PoliciesRegistry(vm.parseJsonAddress(json, ".ebsi.PolicyRegistry.contractAddress"));
        DidRegistry didr = DidRegistry(vm.parseJsonAddress(json, ".ebsi.DidRegistry.contractAddress"));
        IssuersRegistry tir = IssuersRegistry(vm.parseJsonAddress(json, ".ebsi.IssuersRegistry.contractAddress"));

        uint256 deployerKey = _developmentKey(DEVELOPMENT_DEPLOYER);
        uint256 signerAKey = _developmentKey(DEVELOPMENT_SIGNER_A);
        uint256 signerBKey = _developmentKey(DEVELOPMENT_SIGNER_B);
        uint256 rootKey = _developmentKey(DEVELOPMENT_ROOT_TAO);
        uint256 taoKey = _developmentKey(DEVELOPMENT_TAO);
        uint256 nbuKey = _developmentKey(DEVELOPMENT_NBU);

        // The deployer administers the EBSI contracts: only it may define a
        // policy and grant one. It also pays for the key the genesis left out.
        vm.startBroadcast(deployerKey);
        if (vm.addr(nbuKey).balance < GAS_MONEY) payable(vm.addr(nbuKey)).transfer(GAS_MONEY);
        // The RootTAO accredits itself; nobody above it could.
        policies.insertPolicy(BOOTSTRAP_POLICY, "Bootstrap the RootTAO");
        string[] memory attributes = new string[](1);
        attributes[0] = BOOTSTRAP_POLICY;
        policies.insertUserAttributes(vm.addr(rootKey), attributes);
        vm.stopBroadcast();

        // Each DID inserted by the key that will control it.
        vm.broadcast(rootKey);
        _insertDid(didr, ROOT, rootKey);
        vm.broadcast(taoKey);
        _insertDid(didr, TAO, taoKey);
        vm.broadcast(nbuKey);
        _insertDid(didr, NBU, nbuKey);
        vm.startBroadcast(signerAKey);
        _insertDid(didr, TI, signerAKey);
        string memory second = string.concat(TI, "#key-2");
        didr.addVerificationMethod(TI, second, _publicKey(signerBKey), true);
        didr.addVerificationRelationship(
            TI, "capabilityInvocation", second, block.timestamp, block.timestamp + 365 days
        );
        vm.stopBroadcast();

        bytes32 rootAttribute = _attributeId(ROOT);
        bytes32 taoAttribute = _attributeId(TAO);
        vm.startBroadcast(rootKey);
        tir.setAttributeMetadata(ROOT, SALT, TIR.IssuerType.RootTAO, ROOT, bytes32(0));
        tir.setAttributeMetadata(TAO, SALT, TIR.IssuerType.TAO, ROOT, rootAttribute);
        vm.stopBroadcast();

        vm.broadcast(taoKey);
        tir.setAttributeMetadata(TI, SALT, TIR.IssuerType.TI, TAO, taoAttribute);

        console.log(string.concat("TI_DID=", TI));
        console.log(string.concat("TI_ATTRIBUTE_ID=", vm.toString(_attributeId(TI))));
        console.log(string.concat("COSIGNER_DID=", NBU));
    }

    function _insertDid(DidRegistry didr, string memory did, uint256 key) private {
        didr.insertDidDocument(
            did, "{}", string.concat(did, "#key-1"), _publicKey(key), true, block.timestamp, block.timestamp + 365 days
        );
    }

    function _publicKey(uint256 key) private returns (bytes memory) {
        Vm.Wallet memory wallet = vm.createWallet(key);
        return abi.encodePacked(bytes1(0x04), wallet.publicKeyX, wallet.publicKeyY);
    }

    /// IssuersRegistry._deriveRevisionId for a first accreditation.
    function _attributeId(string memory did) private pure returns (bytes32) {
        return sha256(abi.encode(did, SALT, uint256(0), bytes("")));
    }
}
