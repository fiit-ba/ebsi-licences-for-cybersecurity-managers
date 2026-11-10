// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title IVersionedBeaconProxy
 * @dev Proxy that pins a beacon version; upgrade is opt-in via upgradeToVersion.
 */
interface IVersionedBeaconProxy {
    function version() external view returns (uint64);

    function beacon() external view returns (address);

    function proxyOwner() external view returns (address);

    function upgradeToVersion(uint64 newVersion, bytes memory data) external;

    event ProxyUpgraded(uint64 indexed oldVersion, uint64 indexed newVersion, address indexed newImplementation);
    event ProxyOwnerChanged(address indexed oldOwner, address indexed newOwner);
}
