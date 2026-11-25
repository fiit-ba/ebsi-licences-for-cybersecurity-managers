pragma solidity 0.8.26;

import {POLICY_KINDS} from "../interfaces/IGovernanceTypes.sol";
import {ITiConfiguration} from "../interfaces/ITiConfiguration.sol";
import {PolicyRules} from "../libraries/PolicyRules.sol";
import {Role, RoleSet} from "../libraries/Roles.sol";
import {TiAccreditation} from "./TiAccreditation.sol";

/**
 * @title TiConfiguration
 * @notice The rules each TI's proposals are decided by: who signs as which
 *         role (component 10.2), a policy per kind of decision, and how long a
 *         proposal may stay open. The TAO sets them up; after that only the
 *         TI's own quorum changes them (RuleChanges), and the TAO its cosigners.
 */
abstract contract TiConfiguration is ITiConfiguration, TiAccreditation {
    using PolicyRules for Policy;

    // -----------------------------------------------------------------------
    // Limits
    // -----------------------------------------------------------------------

    /// @notice Roles are 1..8, so a set of them fits one byte.
    uint8 public constant MAX_ROLE = 8;

    /// @notice No timelock longer than this: a longer one is a typo that would
    ///         freeze the TI, not a governance choice.
    uint64 public constant MAX_TIMELOCK = 90 days;

    /// @notice No proposal lives longer than this.
    uint64 public constant MAX_PROPOSAL_TTL = 365 days;

    /// @notice A proposal lives at least this much longer than the TI's
    ///         longest timelock: time to collect the signatures, and then
    ///         to execute. A shorter lifetime would let nothing pass, not
    ///         even the rule change that lengthens it.
    uint64 public constant MIN_SIGNING_WINDOW = 1 days;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    struct TiConfig {
        string did;
        bytes32 attributeId;
        address[] signers;
        Cosigner[] cosigners;
        Policy[POLICY_KINDS] policies; // indexed by PolicyKind
        uint64 proposalTtl;
        uint64 version;
        /// Raised by every cosigner change, which ends the TI's open
        /// proposals (`Ballots._lapsed`). Last, to keep the layout.
        uint64 cosignerEpoch;
    }

    /// @custom:storage-location erc7201:plr.storage.TiConfiguration
    struct TiConfigurationStorage {
        mapping(bytes32 => TiConfig) tis;
        /// @dev The role of a TI's own key. Component 10.4: organisational keys
        ///      held in an HSM, never personal identifiers.
        mapping(bytes32 => mapping(address => Role)) signerRole;
        /// @dev A retired key cannot be added again - re-adding it would revive
        ///      its old signatures without anyone re-signing, and the quorum
        ///      would keep its original timelock instead of restarting
        ///      (Ballots._sign).
        mapping(bytes32 => mapping(address => bool)) retired;
    }

    /// @dev `cast index-erc7201 plr.storage.TiConfiguration`
    bytes32 private constant TI_CONFIGURATION_STORAGE =
        0xe304479f84b2390f8423473cb17495badde693c4682e6ae57d40f7b6ec675e00;

    function _configurationStorage() private pure returns (TiConfigurationStorage storage $) {
        assembly ("memory-safe") {
            $.slot := TI_CONFIGURATION_STORAGE
        }
    }

    // -----------------------------------------------------------------------
    // Setting up a TI
    // -----------------------------------------------------------------------

    /// @dev `isActiveTi` proves the accreditation, and each key's check proves
    ///      the DID exists: the registry accredits a DID without looking it up.
    function addTi(TiSetup calldata setup) external onlyTao returns (bytes32 tiId) {
        tiId = _tiId(setup.did);
        TiConfig storage ti = _configurationStorage().tis[tiId];
        if (bytes(ti.did).length != 0) revert TiAlreadyConfigured();
        if (!isActiveTi(setup.did, setup.attributeId)) revert TiNotActive();
        if (setup.signers.length == 0 || setup.signers.length != setup.roles.length) revert InvalidSigner();

        ti.did = setup.did;
        ti.attributeId = setup.attributeId;
        for (uint256 i = 0; i < setup.signers.length; i++) {
            _requireNewSigner(tiId, setup.signers[i], setup.roles[i]);
            _addSigner(tiId, setup.signers[i], setup.roles[i]);
        }
        _storeCosigners(ti, setup.cosigners);
        emit CosignersChanged(tiId, setup.cosigners);

        RoleSet present = _rolesPresent(tiId);
        for (uint8 kind = 0; kind < POLICY_KINDS; kind++) {
            _requirePolicy(setup.policies[kind], present);
            _setPolicy(tiId, PolicyKind(kind), setup.policies[kind]);
        }
        _requireAdminCovers(setup.policies);
        _requireCosignersApart(tiId);
        _setProposalTtl(tiId, setup.proposalTtl);
        emit TiConfigured(tiId, setup.did, setup.attributeId);
    }

    function setTiAttribute(bytes32 tiId, bytes32 attributeId) external onlyTao {
        TiConfig storage ti = _ti(tiId);
        if (!isActiveTi(ti.did, attributeId)) revert TiNotActive();
        ti.attributeId = attributeId;
        ti.version++;
        emit TiAttributeChanged(tiId, attributeId);
    }

    function setCosigners(bytes32 tiId, Cosigner[] calldata cosigners) external onlyTao {
        TiConfig storage ti = _ti(tiId);
        bool changed = !_sameCosigners(ti.cosigners, cosigners);
        delete ti.cosigners;
        _storeCosigners(ti, cosigners);
        _requireCosignersApart(tiId);
        _requireReachable(tiId, _rolesPresent(tiId));
        ti.version++;
        if (changed) ti.cosignerEpoch++;
        emit CosignersChanged(tiId, cosigners);
    }

    /// @dev The same DIDs in the same roles and order: `roleOf` takes the
    ///      first DID that lists a key, so the order counts too.
    function _sameCosigners(Cosigner[] storage current, Cosigner[] calldata next) private view returns (bool) {
        if (current.length != next.length) return false;
        for (uint256 i = 0; i < next.length; i++) {
            if (Role.unwrap(current[i].role) != Role.unwrap(next[i].role)) return false;
            if (keccak256(bytes(current[i].did)) != keccak256(bytes(next[i].did))) return false;
        }
        return true;
    }

    /// @dev One role per DID, and no DID holding a TI key: `roleOf` gives a
    ///      key one role, so a role nobody can sign with would count as present.
    function _storeCosigners(TiConfig storage ti, Cosigner[] calldata cosigners) private {
        for (uint256 i = 0; i < cosigners.length; i++) {
            bytes32 did = keccak256(bytes(cosigners[i].did));
            if (bytes(cosigners[i].did).length == 0 || did == keccak256(bytes(ti.did))) revert InvalidCosigner();
            for (uint256 j = 0; j < i; j++) {
                if (keccak256(bytes(cosigners[j].did)) == did) revert InvalidCosigner();
            }
            if (Role.unwrap(cosigners[i].role) == 0 || Role.unwrap(cosigners[i].role) > MAX_ROLE) revert InvalidRole();
            for (uint256 j = 0; j < ti.signers.length; j++) {
                if (_controls(cosigners[i].did, ti.signers[j])) revert CosignerSharesSignerKey();
            }
            ti.cosigners.push(cosigners[i]);
        }
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function computeTiId(string calldata did) external pure returns (bytes32) {
        return _tiId(did);
    }

    /// @dev Live: a key the DID Registry no longer shows holds no role, so a
    ///      signature counts only while its key is valid.
    function roleOf(bytes32 tiId, address account) public view returns (Role role) {
        TiConfigurationStorage storage $ = _configurationStorage();
        TiConfig storage ti = $.tis[tiId];
        role = $.signerRole[tiId][account];
        if (Role.unwrap(role) != 0) return _controls(ti.did, account) ? role : Role.wrap(0);
        for (uint256 i = 0; i < ti.cosigners.length; i++) {
            if (_controls(ti.cosigners[i].did, account)) return ti.cosigners[i].role;
        }
    }

    /// @inheritdoc ITiConfiguration
    function retired(bytes32 tiId, address account) external view returns (bool) {
        return _configurationStorage().retired[tiId][account];
    }

    function isSigner(bytes32 tiId, address account) external view returns (bool) {
        return Role.unwrap(roleOf(tiId, account)) != 0;
    }

    function getPolicy(bytes32 tiId, PolicyKind kind) external view returns (Policy memory) {
        return _policy(tiId, kind);
    }

    function getTi(bytes32 tiId) external view returns (TiView memory result) {
        TiConfig storage ti = _ti(tiId);
        result.did = ti.did;
        result.attributeId = ti.attributeId;
        result.signers = ti.signers;
        result.roles = new Role[](ti.signers.length);
        for (uint256 i = 0; i < ti.signers.length; i++) {
            result.roles[i] = _signerRole(tiId, ti.signers[i]);
        }
        result.cosigners = ti.cosigners;
        result.policies = ti.policies;
        result.proposalTtl = ti.proposalTtl;
        result.version = ti.version;
        result.rolesPresentMask = _rolesPresent(tiId);
    }

    // -----------------------------------------------------------------------
    // Access
    // -----------------------------------------------------------------------

    function _tiId(string memory did) internal pure returns (bytes32) {
        return keccak256(bytes(did));
    }

    function _ti(bytes32 tiId) private view returns (TiConfig storage ti) {
        ti = _configurationStorage().tis[tiId];
        if (bytes(ti.did).length == 0) revert UnknownTi();
    }

    function _policy(bytes32 tiId, PolicyKind kind) internal view returns (Policy memory) {
        return _configurationStorage().tis[tiId].policies[uint8(kind)];
    }

    function _cosignerEpoch(bytes32 tiId) internal view returns (uint64) {
        return _configurationStorage().tis[tiId].cosignerEpoch;
    }

    function _proposalTtl(bytes32 tiId) internal view returns (uint64) {
        return _configurationStorage().tis[tiId].proposalTtl;
    }

    function _bumpVersion(bytes32 tiId) internal {
        _configurationStorage().tis[tiId].version++;
    }

    function _requireSigner(bytes32 tiId) internal view {
        requireSigner(tiId, msg.sender);
    }

    function requireSigner(bytes32 tiId, address account) public view {
        if (Role.unwrap(roleOf(tiId, account)) == 0) revert NotASigner();
    }

    /// @dev Asked when something starts and when it takes effect, not of every
    ///      signature: each check walks the registry's whole trust chain.
    function _requireActive(bytes32 tiId) internal view {
        TiConfig storage ti = _ti(tiId);
        if (!isActiveTi(ti.did, ti.attributeId)) revert TiNotActive();
    }

    function requireActiveSigner(bytes32 tiId, address account) public view {
        requireSigner(tiId, account);
        _requireActive(tiId);
    }

    // -----------------------------------------------------------------------
    // Signers
    // -----------------------------------------------------------------------

    /// @dev Nor a key of a cosigner's DID, which the DID Registry may change, so
    ///      it is asked again when a rule change executes.
    function _requireNewSigner(bytes32 tiId, address signer, Role role) internal view {
        TiConfigurationStorage storage $ = _configurationStorage();
        if (signer == address(0)) revert InvalidSigner();
        if (Role.unwrap($.signerRole[tiId][signer]) != 0) revert DuplicateSigner();
        if ($.retired[tiId][signer]) revert SignerRetired();
        if (Role.unwrap(role) == 0 || Role.unwrap(role) > MAX_ROLE) revert InvalidRole();
        if (!_controls($.tis[tiId].did, signer)) revert NotDidController();
        Cosigner[] storage cosigners = $.tis[tiId].cosigners;
        for (uint256 i = 0; i < cosigners.length; i++) {
            if (_controls(cosigners[i].did, signer)) revert CosignerSharesSignerKey();
        }
    }

    /// @dev The stored role, whatever the DID Registry says of the key now.
    function _signerRole(bytes32 tiId, address signer) internal view returns (Role) {
        return _configurationStorage().signerRole[tiId][signer];
    }

    function _addSigner(bytes32 tiId, address signer, Role role) internal {
        TiConfigurationStorage storage $ = _configurationStorage();
        $.signerRole[tiId][signer] = role;
        $.tis[tiId].signers.push(signer);
        emit SignerAdded(tiId, signer, role);
    }

    function _dropSigner(bytes32 tiId, address signer) internal {
        TiConfigurationStorage storage $ = _configurationStorage();
        address[] storage signers = $.tis[tiId].signers;
        $.signerRole[tiId][signer] = Role.wrap(0);
        $.retired[tiId][signer] = true;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                return;
            }
        }
    }

    /// @dev `replacement` takes `signer`'s role, and `signer` retires.
    function _replaceSigner(bytes32 tiId, address signer, address replacement) internal returns (Role role) {
        TiConfigurationStorage storage $ = _configurationStorage();
        role = $.signerRole[tiId][signer];
        _dropSigner(tiId, signer);
        $.signerRole[tiId][replacement] = role;
        $.tis[tiId].signers.push(replacement);
    }

    /// @dev The roles that hold at least one key or cosigner.
    function _rolesPresent(bytes32 tiId) internal view returns (RoleSet) {
        return _rolesPresentExcluding(tiId, address(0));
    }

    /// @dev The roles that would remain if `excluded` were removed.
    function _rolesPresentExcluding(bytes32 tiId, address excluded) internal view returns (RoleSet roles) {
        TiConfigurationStorage storage $ = _configurationStorage();
        TiConfig storage ti = $.tis[tiId];
        for (uint256 i = 0; i < ti.signers.length; i++) {
            if (ti.signers[i] != excluded) roles = roles.with($.signerRole[tiId][ti.signers[i]]);
        }
        for (uint256 i = 0; i < ti.cosigners.length; i++) {
            roles = roles.with(ti.cosigners[i].role);
        }
    }

    // -----------------------------------------------------------------------
    // Policies
    // -----------------------------------------------------------------------

    function _requirePolicy(Policy memory policy, RoleSet present) internal pure {
        if (policy.timelock > MAX_TIMELOCK || !policy.wellFormed(present)) revert InvalidPolicy();
    }

    /// @dev Every policy of the TI stays reachable with the roles `present`.
    function _requireReachable(bytes32 tiId, RoleSet present) internal view {
        for (uint8 kind = 0; kind < POLICY_KINDS; kind++) {
            if (!_policy(tiId, PolicyKind(kind)).reachable(present)) revert Unsatisfiable();
        }
    }

    // -----------------------------------------------------------------------
    // Cosigners: beside the TI, never in its place
    // -----------------------------------------------------------------------

    /// @dev No cosigner holds a TI key's role, and cosigners alone meet no threshold.
    function _requireCosignersApart(bytes32 tiId) internal view {
        RoleSet cosigned = _cosignerRoles(tiId);
        if (_signerRoles(tiId).intersects(cosigned)) revert CosignerHoldsSignerRole();
        for (uint8 kind = 0; kind < POLICY_KINDS; kind++) {
            _requireAboveCosigners(cosigned, _policy(tiId, PolicyKind(kind)));
        }
    }

    /// @dev A key added for `role` would share it with a cosigner.
    function _requireRoleNotCosigned(bytes32 tiId, Role role) internal view {
        if (_cosignerRoles(tiId).contains(role)) revert CosignerHoldsSignerRole();
    }

    /// @dev The cosigners' roles alone cannot meet `policy`'s threshold.
    function _requireAboveCosigners(RoleSet cosigned, Policy memory policy) internal pure {
        if (cosigned.count() >= policy.threshold) revert CosignersMeetAQuorum();
    }

    /// @dev The roles the cosigners hold, whatever the DID Registry says now.
    function _cosignerRoles(bytes32 tiId) internal view returns (RoleSet roles) {
        Cosigner[] storage cosigners = _configurationStorage().tis[tiId].cosigners;
        for (uint256 i = 0; i < cosigners.length; i++) {
            roles = roles.with(cosigners[i].role);
        }
    }

    /// @dev The roles the TI's own keys hold, whatever the DID Registry says now.
    function _signerRoles(bytes32 tiId) private view returns (RoleSet roles) {
        TiConfigurationStorage storage $ = _configurationStorage();
        address[] storage signers = $.tis[tiId].signers;
        for (uint256 i = 0; i < signers.length; i++) {
            roles = roles.with($.signerRole[tiId][signers[i]]);
        }
    }

    /// @dev The TI's policies with `kind` replaced by `policy`.
    function _policiesWith(bytes32 tiId, PolicyKind kind, Policy memory policy)
        internal
        view
        returns (Policy[POLICY_KINDS] memory policies)
    {
        policies = _configurationStorage().tis[tiId].policies;
        policies[uint8(kind)] = policy;
    }

    /// @dev ADMIN covers every status policy (`PolicyRules.covers`).
    function _requireAdminCovers(Policy[POLICY_KINDS] memory policies) internal pure {
        Policy memory admin = policies[uint8(PolicyKind.ADMIN)];
        for (uint8 kind = 0; kind < uint8(PolicyKind.ADMIN); kind++) {
            if (!admin.covers(policies[kind])) revert AdminPolicyTooWeak();
        }
    }

    function _setPolicy(bytes32 tiId, PolicyKind kind, Policy memory policy) internal {
        _configurationStorage().tis[tiId].policies[uint8(kind)] = policy;
        emit PolicyChanged(tiId, kind, policy.threshold, policy.requiredRoleMask, policy.vetoRoleMask, policy.timelock);
    }

    /// @dev Against the TI's policies as they stand: `addTi` sets them first.
    function _requireTtl(bytes32 tiId, uint64 ttl) internal view {
        if (ttl > MAX_PROPOSAL_TTL || ttl < _longestTimelock(tiId) + MIN_SIGNING_WINDOW) revert InvalidTtl();
    }

    /// @dev A policy's timelock leaves its proposals time to be signed and
    ///      executed within the TI's lifetime.
    function _requireTimelockWithinTtl(bytes32 tiId, uint64 timelock) internal view {
        if (timelock + MIN_SIGNING_WINDOW > _proposalTtl(tiId)) revert InvalidPolicy();
    }

    function _longestTimelock(bytes32 tiId) private view returns (uint64 longest) {
        for (uint8 kind = 0; kind < POLICY_KINDS; kind++) {
            uint64 timelock = _policy(tiId, PolicyKind(kind)).timelock;
            if (timelock > longest) longest = timelock;
        }
    }

    function _setProposalTtl(bytes32 tiId, uint64 ttl) internal {
        _requireTtl(tiId, ttl);
        _configurationStorage().tis[tiId].proposalTtl = ttl;
        emit ProposalTtlChanged(tiId, ttl);
    }
}
