// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Role} from "../contracts/libraries/Roles.sol";
import {GovernanceConfigFile} from "./GovernanceConfigFile.sol";
import {Networks} from "./Networks.sol";

/**
 * Set up a TI on the governance contract, as the TAO.
 *
 * The TI must already be accredited by the contract's TAO in the Trusted
 * Issuers Registry, and each signer must be a valid key of its DID in the DID
 * Registry: the contract checks both. On a development chain SeedEbsi.s.sol
 * puts them there.
 *
 * Environment:
 *   GOVERNANCE                      the contract; default deployments/<network>.json
 *   TI_DID                          the TI's DID
 *   TI_ATTRIBUTE_ID                 its accreditation attribute in the registry
 *   SIGNER_A / SIGNER_B / SIGNER_C  its keys by role; unset roles have no key. On a
 *                                   dev chain dev keys 1, 2 and 5 by default (Networks.sol)
 *   COSIGNER_DID                    a DID that signs from outside the TI (NBÚ), optional
 *   COSIGNER_ROLE                   its role, default C
 *   GOVERNANCE_CONFIG               policies, default config/pilot.json
 *   GOVERNANCE_TAO_KEY              the TAO's key; default dev key 4
 */
contract AddTi is Script, GovernanceConfigFile, Networks {
    function run() external returns (bytes32 tiId) {
        bool development = _isDevelopment();
        (IGovernanceTypes.Policy[4] memory policies, uint64 proposalTtl) =
            _readConfig(vm.envOr("GOVERNANCE_CONFIG", string("config/pilot.json")));
        IGovernanceTypes.Cosigner[] memory cosigners = _cosigners();
        (address[] memory signers, Role[] memory roles) = _signers(development, cosigners.length > 0);

        IGovernanceTypes.TiSetup memory setup = IGovernanceTypes.TiSetup({
            did: vm.envString("TI_DID"),
            attributeId: vm.envBytes32("TI_ATTRIBUTE_ID"),
            signers: signers,
            roles: roles,
            cosigners: cosigners,
            policies: policies,
            proposalTtl: proposalTtl
        });

        uint256 taoKey = development
            ? vm.envOr("GOVERNANCE_TAO_KEY", _developmentKey(DEVELOPMENT_TAO))
            : vm.envUint("GOVERNANCE_TAO_KEY");
        CertificateGovernance governance = CertificateGovernance(_governance());
        vm.broadcast(taoKey);
        tiId = governance.addTi(setup);

        console.log("TI           :", setup.did);
        console.log("TI id        :", vm.toString(tiId));
        for (uint256 i = 0; i < signers.length; i++) {
            console.log(string.concat("key ", _letter(roles[i]), "        :"), signers[i]);
        }
    }

    function _cosigners() internal view returns (IGovernanceTypes.Cosigner[] memory cosigners) {
        string memory did = vm.envOr("COSIGNER_DID", string(""));
        if (bytes(did).length == 0) return new IGovernanceTypes.Cosigner[](0);
        cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner(did, _role(vm.envOr("COSIGNER_ROLE", string("C"))));
    }

    /// The key of each role from SIGNER_<letter>. Role C is a cosigner's when
    /// there is one, or the external signer would be the body's own key.
    function _signers(bool development, bool hasCosigner)
        internal
        view
        returns (address[] memory signers, Role[] memory roles)
    {
        string[3] memory letters = ["A", "B", "C"];
        uint256[3] memory developmentKeys = [DEVELOPMENT_SIGNER_A, DEVELOPMENT_SIGNER_B, DEVELOPMENT_NBU];
        uint256 count = hasCosigner ? 2 : 3;
        address[] memory found = new address[](count);
        Role[] memory foundRoles = new Role[](count);
        uint256 n;
        for (uint256 i = 0; i < count; i++) {
            address fallbackKey = development ? _developmentAccount(developmentKeys[i]) : address(0);
            address key = vm.envOr(string.concat("SIGNER_", letters[i]), fallbackKey);
            if (key == address(0)) continue;
            require(
                development || !_isDevelopmentAccount(key),
                string.concat("The key of role ", letters[i], " is a public development key")
            );
            found[n] = key;
            foundRoles[n++] = _role(letters[i]);
        }
        signers = new address[](n);
        roles = new Role[](n);
        for (uint256 i = 0; i < n; i++) {
            (signers[i], roles[i]) = (found[i], foundRoles[i]);
        }
    }

    function _governance() internal view returns (address governance) {
        governance = vm.envOr("GOVERNANCE", address(0));
        if (governance != address(0)) return governance;
        return vm.parseJsonAddress(vm.readFile(_recordFile()), ".CertificateGovernance.address");
    }
}
