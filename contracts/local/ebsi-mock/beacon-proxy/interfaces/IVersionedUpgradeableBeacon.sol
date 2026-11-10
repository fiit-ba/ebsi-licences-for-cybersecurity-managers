// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import {IBeacon} from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";

/**
 * @title IVersionedUpgradeableBeacon
 * @dev Beacon that stores multiple implementations by version and tracks, per proxy, the pinned
 *      version and the owner allowed to opt into a new version. Proxies hold no upgrade logic of
 *      their own: they resolve their implementation through the parameterless `implementation()`
 *      (keyed by the calling proxy) and all version/ownership state lives here.
 */
interface IVersionedUpgradeableBeacon is IBeacon {
    /// @dev Per-version record kept by the beacon.
    struct Version {
        address implementation;
        /// @dev True when this version introduced breaking storage changes vs. its predecessor.
        bool isBreakingChange;
        /// @dev Running count of breaking changes up to and including this version. Two versions
        ///      are storage-compatible (can be moved between directly) if their counts are equal —
        ///      this is what makes compatibility transitive across any number of intermediate versions,
        ///      not just the single boundary version being crossed.
        uint16 breakingChangeCount;
        /// @dev Storage layout hash, used to reason about proxy compatibility.
        bytes32 storageLayoutHash;
        bool deprecated;
    }

    function latestVersion() external view returns (uint64);

    function implementation(uint64 version) external view returns (address);

    function isVersionAvailable(uint64 version) external view returns (bool);

    /// @dev Full record for a version (implementation, hashes, and flags).
    function getVersion(uint64 version) external view returns (Version memory);

    /// @dev Optional: returns all registered version numbers (may be expensive).
    function getVersions() external view returns (uint64[] memory);

    /// @dev Whether a proxy can move directly between `fromVersion` and `toVersion` without
    ///      crossing a breaking storage change. Direction-agnostic — used to guard both
    ///      upgrades and downgrades.
    function getVersionsCompatibility(uint64 fromVersion, uint64 toVersion) external view returns (bool);

    /// @dev Called by a proxy in its constructor (msg.sender == the proxy) to pin the latest
    ///      version and record its initial owner. One-time per proxy.
    function registerProxy(address initialOwner) external;

    /// @dev Opt-in upgrade: the proxy's owner switches the proxy to an available version.
    ///      When `safeUpgrade` is true, the call reverts if any version crossed between the
    ///      proxy's current version and `version` is flagged as breaking.
    function upgradeProxyToVersion(address proxy, uint64 version, bool safeUpgrade) external;

    /// @dev Transfer the per-proxy owner (the account allowed to upgrade that proxy).
    function transferProxyOwnership(address proxy, address newOwner) external;

    /// @dev Effective version a proxy resolves to (latest if it was never pinned).
    function proxyVersionOf(address proxy) external view returns (uint64);

    function proxyOwnerOf(address proxy) external view returns (address);

    event VersionAdded(
        uint64 indexed version, address indexed implementation, bytes32 storageLayoutHash, bool isBreakingChange
    );
    event VersionDeprecated(uint64 indexed version);
    event ProxyRegistered(address indexed proxy, address indexed owner, uint64 version);
    event ProxyUpgraded(address indexed proxy, uint64 oldVersion, uint64 newVersion, address implementation);
    event ProxyOwnerChanged(address indexed proxy, address indexed oldOwner, address indexed newOwner);
}
