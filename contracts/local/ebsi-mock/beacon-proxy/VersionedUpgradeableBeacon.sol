// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVersionedUpgradeableBeacon.sol";

/**
 * @title VersionedUpgradeableBeacon
 * @dev Implements Ownable and maintains multiple implementations by version.
 *      Per-proxy version pinning and ownership live here (not on the proxy), so proxies carry no
 *      upgrade selectors that could shadow their implementation's ABI. A proxy registers itself in
 *      its constructor; thereafter `implementation()` is resolved per calling proxy via its pinned
 *      version. The parameterless `implementation()` falls back to the latest version for callers
 *      that have not pinned one (e.g. a proxy mid-construction, or off-chain readers).
 */
contract VersionedUpgradeableBeacon is IVersionedUpgradeableBeacon, Ownable {
    uint64 private _latestVersion;
    mapping(uint64 => Version) private _versionOf;
    uint64[] private _versions;

    mapping(address => uint64) private _proxyVersion;
    mapping(address => address) private _proxyOwner;

    error VersionMustIncrease();
    error VersionNotAvailable();
    error NotProxyOwner();
    error ProxyAlreadyRegistered();
    error ZeroAddress();
    error ZeroStorageLayoutHash();
    error UnsafeUpgrade();
    error StorageLayoutUnchanged();
    error ImplementationNotContract();
    error SameVersion();
    error SameOwner();
    error VersionAlreadyDeprecated();

    constructor(address ebsiOwner, address initialImplementation, bytes32 initialStorageLayoutHash) Ownable(ebsiOwner) {
        if (initialImplementation == address(0)) revert ZeroAddress();
        if (initialImplementation.code.length == 0) {
            revert ImplementationNotContract();
        }
        if (initialStorageLayoutHash == bytes32(0)) {
            revert ZeroStorageLayoutHash();
        }
        _latestVersion = 1;
        // Version 1 has no predecessor, so it can never be a breaking change.
        _versionOf[1] = Version({
            implementation: initialImplementation,
            isBreakingChange: false,
            breakingChangeCount: 0,
            deprecated: false,
            storageLayoutHash: initialStorageLayoutHash
        });
        _versions.push(1);
        emit VersionAdded(1, initialImplementation, initialStorageLayoutHash, false);
    }

    /// @dev IBeacon: resolves the implementation for the calling proxy's pinned version.
    ///      Unpinned callers (version 0) fall back to the latest version.
    function implementation() external view override returns (address) {
        uint64 v = _proxyVersion[msg.sender];
        if (v == 0) v = _latestVersion;
        return _versionOf[v].implementation;
    }

    function implementation(uint64 version) external view override returns (address) {
        return _versionOf[version].implementation;
    }

    function latestVersion() external view override returns (uint64) {
        return _latestVersion;
    }

    function isVersionAvailable(uint64 version) public view override returns (bool) {
        Version storage v = _versionOf[version];
        return v.implementation != address(0) && !v.deprecated;
    }

    function getVersion(uint64 version) external view override returns (Version memory) {
        return _versionOf[version];
    }

    function getVersions() external view override returns (uint64[] memory) {
        return _versions;
    }

    function proxyVersionOf(address proxy) external view override returns (uint64) {
        uint64 v = _proxyVersion[proxy];
        return v == 0 ? _latestVersion : v;
    }

    function proxyOwnerOf(address proxy) external view override returns (address) {
        return _proxyOwner[proxy];
    }

    /// @dev Beacon admin: register a new implementation version (must be strictly greater than latestVersion).
    ///      `newImplementation` must be a deployed contract (non-zero code size), to guard against
    ///      pinning a version to an EOA or an address with no code.
    ///      `storageLayoutHash` records the implementation's storage layout, and `isBreakingChange`
    ///      marks whether it introduces breaking storage changes relative to the current latest version.
    ///      A version cannot be flagged as breaking if its storage layout hash is identical to the
    ///      current latest version's — an unchanged layout can't be a breaking change.
    function addVersion(uint64 version, address newImplementation, bytes32 storageLayoutHash, bool isBreakingChange)
        external
        onlyOwner
    {
        if (version <= _latestVersion) revert VersionMustIncrease();
        if (newImplementation == address(0)) revert ZeroAddress();
        if (newImplementation.code.length == 0) {
            revert ImplementationNotContract();
        }
        if (storageLayoutHash == bytes32(0)) revert ZeroStorageLayoutHash();
        if (isBreakingChange && storageLayoutHash == _versionOf[_latestVersion].storageLayoutHash) {
            revert StorageLayoutUnchanged();
        }
        uint16 breakingChangeCount = _versionOf[_latestVersion].breakingChangeCount + (isBreakingChange ? 1 : 0);
        _latestVersion = version;
        _versionOf[version] = Version({
            implementation: newImplementation,
            isBreakingChange: isBreakingChange,
            breakingChangeCount: breakingChangeCount,
            deprecated: false,
            storageLayoutHash: storageLayoutHash
        });
        _versions.push(version);
        emit VersionAdded(version, newImplementation, storageLayoutHash, isBreakingChange);
    }

    /// @dev Beacon admin: mark a version as deprecated (existing proxies on that version keep working).
    function deprecateVersion(uint64 version) external onlyOwner {
        Version storage v = _versionOf[version];
        if (v.implementation == address(0)) revert VersionNotAvailable();
        if (v.deprecated) revert VersionAlreadyDeprecated();
        v.deprecated = true;
        emit VersionDeprecated(version);
    }

    /// @dev Called by a proxy during construction (msg.sender == the proxy): pins the current latest
    ///      version and records the proxy's initial owner. One-time per proxy. Reverts if the latest
    ///      version has been deprecated, since new proxies should never launch onto a deprecated version.
    function registerProxy(address initialOwner) external override {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (_proxyOwner[msg.sender] != address(0)) {
            revert ProxyAlreadyRegistered();
        }
        uint64 v = _latestVersion;
        if (!isVersionAvailable(v)) revert VersionNotAvailable();
        _proxyVersion[msg.sender] = v;
        _proxyOwner[msg.sender] = initialOwner;
        emit ProxyRegistered(msg.sender, initialOwner, v);
    }

    /// @dev Opt-in upgrade: the proxy's owner switches that proxy to an available version.
    ///      When `safeUpgrade` is true, the upgrade reverts if `version` is not compatible with
    ///      the proxy's current version (see {getVersionsCompatibility}).
    function upgradeProxyToVersion(address proxy, uint64 version, bool safeUpgrade) external override {
        if (msg.sender != _proxyOwner[proxy]) revert NotProxyOwner();
        if (!isVersionAvailable(version)) revert VersionNotAvailable();
        uint64 oldVersion = _proxyVersion[proxy];
        if (version == oldVersion) revert SameVersion();
        if (safeUpgrade && !getVersionsCompatibility(oldVersion, version)) {
            revert UnsafeUpgrade();
        }
        _proxyVersion[proxy] = version;
        emit ProxyUpgraded(proxy, oldVersion, version, _versionOf[version].implementation);
    }

    /// @dev Whether a proxy can move directly between `fromVersion` and `toVersion` without
    ///      crossing a breaking storage change. Compares each version's cumulative
    ///      `breakingChangeCount`: equal counts mean no breaking version was registered strictly
    ///      between them, regardless of how many non-breaking versions lie in between.
    ///      Direction-agnostic — used to guard both upgrades and downgrades.
    function getVersionsCompatibility(uint64 fromVersion, uint64 toVersion) public view override returns (bool) {
        return _versionOf[fromVersion].breakingChangeCount == _versionOf[toVersion].breakingChangeCount;
    }

    function transferProxyOwnership(address proxy, address newOwner) external override {
        address oldOwner = _proxyOwner[proxy];
        if (msg.sender != oldOwner) revert NotProxyOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == oldOwner) revert SameOwner();
        _proxyOwner[proxy] = newOwner;
        emit ProxyOwnerChanged(proxy, oldOwner, newOwner);
    }
}
