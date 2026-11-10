// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IGovernanceTypes} from "./IGovernanceTypes.sol";

/**
 * @title ICertificateRegistry
 * @notice The certificate records and their standing: all a verifier reads
 *         (DECISIONS.md D30, D36, D39).
 */
interface ICertificateRegistry is IGovernanceTypes {
    /// @notice The contract allowed to apply executed proposals changed.
    event GovernanceChanged(address governance);

    /// @notice A certificate entered the registry's record (D30, D36).
    event CertificateRegistered(
        bytes32 indexed statusKey,
        bytes32 credentialHash,
        uint64 validFrom,
        uint64 validUntil,
        Standing standing,
        address indexed by
    );
    /// @notice A certificate's standing changed: at once on one signature
    ///         (`proposalId` 0, component 10.6), or by an executed proposal.
    event CertificateStandingChanged(
        bytes32 indexed statusKey, Standing standing, uint256 indexed proposalId, bytes32 reasonHash, address indexed by
    );

    /// @notice Record a certificate when it is issued. One signature: issuing
    ///         is the certification body's own act.
    /// @param certificateIdHash SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", certificateId)).
    /// @param issuerDid The DID of the TI that issued it; one record per id and TI.
    /// @param validFrom When it became valid.
    /// @param validUntil When it expires (0: never).
    /// @param credentialHash SHA-256 of the signed JWT as the TI issued it,
    ///        everything before the first `~` of the SD-JWT, so what a verifier
    ///        is shown can be compared with what was issued (D42).
    /// @param standing VALID when issued; a certificate already suspended or
    ///        revoked when the record is first made (migration) says so.
    /// @return statusKey The key it is recorded under: see `computeStatusKey`.
    function registerCertificate(
        bytes32 certificateIdHash,
        string calldata issuerDid,
        uint64 validFrom,
        uint64 validUntil,
        bytes32 credentialHash,
        Standing standing
    ) external returns (bytes32 statusKey);

    /// @notice The governance contract this registry takes its signers and
    ///         executed proposals from.
    function governance() external view returns (address);

    /// @notice Point the registry at a governance contract. TAO only.
    function setGovernance(address governance_) external;

    /// @notice Refuses a certificate a TI may not propose for: an unknown one,
    ///         another TI's, or a revoked one.
    function requireChangeableBy(bytes32 statusKey, bytes32 tiId) external view;

    /// @notice Set a certificate's standing from an executed proposal.
    ///         Governance only.
    /// @param by Who executed the proposal.
    function applyExecuted(
        bytes32 tiId,
        bytes32 statusKey,
        ActionType actionType,
        uint256 proposalId,
        bytes32 reasonHash,
        address by
    ) external;

    /// @notice Suspend a valid certificate at once, on one signature
    ///         (component 10.6). Reversible; revocation still takes a quorum.
    /// @param reasonHash The reason's commitment (D22), required.
    function suspendNow(bytes32 statusKey, bytes32 reasonHash) external;

    /// @notice The certificate's record; `standing` NONE if there is none.
    function certificateStatus(bytes32 statusKey) external view returns (Certificate memory);

    /// @notice SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash)).
    ///         A public RPC node sees what it is given: compute this locally.
    function computeStatusKey(string calldata issuerDid, string calldata certificateId)
        external
        pure
        returns (bytes32);
}
