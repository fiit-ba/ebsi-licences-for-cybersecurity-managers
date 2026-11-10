// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {GovernanceTest} from "./GovernanceTest.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {IBeacon} from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import {VersionedUpgradeableBeacon} from "ebsi-mock/beacon-proxy/VersionedUpgradeableBeacon.sol";
import {VersionedBeaconProxy} from "ebsi-mock/beacon-proxy/VersionedBeaconProxy.sol";

/// scripts/Deploy.s.sol's actual beacon and proxy: EBSI's own
/// VersionedUpgradeableBeacon and VersionedBeaconProxy (local/ebsi-mock),
/// not the plain OpenZeppelin ones GovernanceTest's fixture uses (see that
/// file's comment on why). `ProxyTemplatesRegistry.addTemplate` only requires
/// `IBeacon(beaconAddress).implementation()` to answer non-zero
/// (ProxyTemplateRegistry.sol). The initializer selector the Proxy Factory
/// reads is checked in CertificateGovernance.t.sol's ProxyTest.
///
/// In a file of its own: a file importing ebsi-mock/ is compiled with via-IR,
/// and coverage (FOUNDRY_PROFILE=coverage) does not count what runs there.
contract EBSIBeaconTest is GovernanceTest {
    function test_TheVersionedBeaconAcceptsTheImplementationAndRegistersTheProxy() public {
        VersionedUpgradeableBeacon versionedBeacon =
            new VersionedUpgradeableBeacon(address(this), address(implementation), keccak256("test-layout"));
        assertEq(IBeacon(address(versionedBeacon)).implementation(), address(implementation));

        bytes memory init = abi.encodeCall(
            CertificateGovernance.initialize,
            (tao, taoDid, didRegistry, issuersRegistry, address(registry))
        );
        CertificateGovernance proxied =
            CertificateGovernance(address(new VersionedBeaconProxy(address(versionedBeacon), init, address(this))));

        assertEq(versionedBeacon.proxyOwnerOf(address(proxied)), address(this));
        assertEq(versionedBeacon.proxyVersionOf(address(proxied)), 1);
        assertEq(proxied.owner(), tao);
    }
}
