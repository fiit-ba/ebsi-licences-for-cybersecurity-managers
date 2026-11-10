// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ICertificateRegistry} from "./interfaces/ICertificateRegistry.sol";
import {ITiConfiguration} from "./interfaces/ITiConfiguration.sol";
import {Hashes} from "./libraries/Hashes.sol";

/**
 * @title CertificateRegistry
 * @notice Each certificate as the registry recorded it - the TI that issued
 *         it, when it is valid from and until - and its standing: valid,
 *         suspended or revoked (DECISIONS.md D30, D36, D39, D41).
 *
 * @dev The record is the only source of truth about a certificate (D36),
 *      keyed by what every presentation discloses - the TI's DID and the
 *      credential's random id (`statusKey`) - replacing status lists entirely.
 *      The id reaches the chain only as a hash, and the certificate's number
 *      not at all (D41). The record also keeps the hash of the signed
 *      credential, which ties it to that credential's content (D42): a
 *      verifier compares it with the JWT it was shown. Registering and
 *      suspending at once take one signature (issuing is the body's own act;
 *      suspension is reversible, component 10.6); every other change
 *      (revocation, reinstatement, ordinary suspension) is a proposal that
 *      must reach quorum in CertificateGovernance, for a recorded certificate
 *      only.
 *
 *      Who may sign is governance's question. What may happen to a certificate
 *      is this contract's, whatever governance asks: a revoked certificate
 *      stays revoked, an id is recorded once per TI, and a TI changes only its
 *      own certificates.
 */
contract CertificateRegistry is ICertificateRegistry, OwnableUpgradeable, ERC165 {
    /// @dev `bytes4(keccak256("getImplementationInitSelector()"))`, EBSI's
    ///      Contracts Factory interface id for a beacon implementation that
    ///      advertises its own initializer selector.
    bytes4 private constant IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID = 0xf622b441;

    /// @custom:storage-location erc7201:plr.storage.CertificateRegistry
    struct CertificateRegistryStorage {
        address governance;
        mapping(bytes32 => Certificate) certificates;
    }

    /// @dev `cast index-erc7201 plr.storage.CertificateRegistry`
    bytes32 private constant CERTIFICATE_REGISTRY_STORAGE =
        0x38627bb7559feb4928ef1220faa399fed15192426e62e47849a0f71a86750700;

    function _registryStorage() private pure returns (CertificateRegistryStorage storage $) {
        assembly ("memory-safe") {
            $.slot := CERTIFICATE_REGISTRY_STORAGE
        }
    }

    modifier onlyGovernance() {
        if (msg.sender != governance()) revert NotGovernance();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Set up the proxy's owner. Governance comes after (`setGovernance`):
     *         it is initialized with this contract's address.
     * @param tao The contract's owner. Named, not taken from `msg.sender`,
     *        which is the Proxy Factory on a factory deployment.
     */
    function initialize(address tao) external initializer {
        __Ownable_init(tao);
    }

    /// @notice The selector EBSI's Contracts Factory calls to initialize a
    ///         proxy deployed against this implementation.
    function getImplementationInitSelector() external pure returns (bytes4) {
        return this.initialize.selector;
    }

    /// @inheritdoc ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    /// @inheritdoc ICertificateRegistry
    function governance() public view returns (address) {
        return _registryStorage().governance;
    }

    /// @dev Without an owner this registry could never leave its governance.
    function renounceOwnership() public pure override {
        revert OwnershipNotRenounceable();
    }

    /// @dev Whoever is set here decides every standing, so this is what the
    ///      timelock in front of the owner has to protect (D39).
    function setGovernance(address governance_) external onlyOwner {
        if (governance_.code.length == 0) revert InvalidGovernance();
        _registryStorage().governance = governance_;
        emit GovernanceChanged(governance_);
    }

    /**
     * @dev The key is computed here, from the TI just checked and the id's
     *      hash, so an id a TI recorded once cannot be recorded again, a TI
     *      cannot take another's key, and a verifier holding the two finds
     *      this record and no other. The credential's hash is not checked
     *      here or kept unique: the contract never sees the credential, and a
     *      hash another TI could copy must not be able to block a record.
     */
    function registerCertificate(
        bytes32 certificateIdHash,
        string calldata issuerDid,
        uint64 validFrom,
        uint64 validUntil,
        bytes32 credentialHash,
        Standing standing
    ) external returns (bytes32 statusKey) {
        if (certificateIdHash == bytes32(0) || credentialHash == bytes32(0) || bytes(issuerDid).length == 0) {
            revert IncompleteCertificate();
        }
        if (validUntil != 0 && validUntil <= validFrom) revert InvalidValidity();
        if (standing == Standing.NONE) revert InvalidStanding();
        ITiConfiguration(governance()).requireActiveSigner(_tiId(issuerDid), msg.sender);
        statusKey = Hashes.statusKey(issuerDid, certificateIdHash);
        Certificate storage certificate = _registryStorage().certificates[statusKey];
        if (certificate.standing != Standing.NONE) revert CertificateAlreadyRegistered();

        certificate.standing = standing;
        certificate.validFrom = validFrom;
        certificate.validUntil = validUntil;
        certificate.registeredAt = uint64(block.timestamp);
        certificate.changedAt = uint64(block.timestamp);
        certificate.credentialHash = credentialHash;
        certificate.issuerDid = issuerDid;
        emit CertificateRegistered(statusKey, credentialHash, validFrom, validUntil, standing, msg.sender);
    }

    /**
     * @dev Component 10.6: a holder reporting a compromised key cannot wait
     *      for a quorum. Suspension is reversible, so one signature is enough;
     *      the revocation that may follow still needs the quorum. The reason
     *      is committed to as for a proposal (D22). A revoked TI may still do
     *      this, on purpose: withdrawing its certificates starts here (D24),
     *      and a verifier reading only this record would otherwise see VALID.
     */
    function suspendNow(bytes32 statusKey, bytes32 reasonHash) external {
        if (reasonHash == bytes32(0)) revert ReasonRequired();
        Certificate storage certificate = _registryStorage().certificates[statusKey];
        if (certificate.standing == Standing.NONE) revert UnknownCertificate();
        ITiConfiguration(governance()).requireSigner(_tiId(certificate.issuerDid), msg.sender);
        if (certificate.standing != Standing.VALID) revert CertificateNotValid();
        _setStanding(statusKey, certificate, Standing.SUSPENDED, 0, reasonHash, msg.sender);
    }

    /// @dev An executed proposal's effect on the record.
    function applyExecuted(
        bytes32 tiId,
        bytes32 statusKey,
        ActionType actionType,
        uint256 proposalId,
        bytes32 reasonHash,
        address by
    ) external onlyGovernance {
        Certificate storage certificate = _changeableRecord(statusKey, tiId);
        Standing next = actionType == ActionType.REVOKE
            ? Standing.REVOKED
            : actionType == ActionType.SUSPEND ? Standing.SUSPENDED : Standing.VALID;
        _setStanding(statusKey, certificate, next, proposalId, reasonHash, by);
    }

    /// @inheritdoc ICertificateRegistry
    function requireChangeableBy(bytes32 statusKey, bytes32 tiId) external view {
        _changeableRecord(statusKey, tiId);
    }

    function certificateStatus(bytes32 statusKey) external view returns (Certificate memory) {
        return _registryStorage().certificates[statusKey];
    }

    function computeStatusKey(string calldata issuerDid, string calldata certificateId)
        external
        pure
        returns (bytes32)
    {
        return Hashes.statusKey(issuerDid, Hashes.certificateIdHash(certificateId));
    }

    /// @dev A TI proposes only for a recorded certificate of its own, and
    ///      nothing for a revoked one: it stays revoked.
    function _changeableRecord(bytes32 statusKey, bytes32 tiId) private view returns (Certificate storage certificate) {
        certificate = _registryStorage().certificates[statusKey];
        if (certificate.standing == Standing.NONE) revert UnknownCertificate();
        if (_tiId(certificate.issuerDid) != tiId) revert NotCertificateIssuer();
        if (certificate.standing == Standing.REVOKED) revert CertificateRevoked();
    }

    /// @dev `computeTiId` of the governance contract.
    function _tiId(string memory did) private pure returns (bytes32) {
        return keccak256(bytes(did));
    }

    function _setStanding(
        bytes32 key,
        Certificate storage certificate,
        Standing standing,
        uint256 proposalId,
        bytes32 reasonHash,
        address by
    ) private {
        certificate.standing = standing;
        certificate.changedAt = uint64(block.timestamp);
        emit CertificateStandingChanged(key, standing, proposalId, reasonHash, by);
    }
}
