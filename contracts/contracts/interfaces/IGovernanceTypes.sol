// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Role, RoleSet} from "../libraries/Roles.sol";

/// @dev One policy per PolicyKind.
uint8 constant POLICY_KINDS = 4;

/**
 * @title IGovernanceTypes
 * @notice The types and errors every part of the Certificate Governance
 *         Contract shares.
 *
 * @dev A role is a `Role` (one number, 1..8) and a set of roles a `RoleSet`
 *      (one bit per role, bit 0 for role 1). Both are `uint8` in the ABI, so
 *      every set is named `...Mask` there and a single role `role`.
 */
interface IGovernanceTypes {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /// @notice The proposal states of component 10.3, with its quorum and
    ///         timelock states as one (D44): APPROVED says the quorum was
    ///         reached, `executableAt` says from when it can run.
    enum ProposalState {
        NONE,
        PROPOSED,
        APPROVED,
        EXECUTED,
        CANCELLED,
        EXPIRED
    }

    /// @notice Status transitions, mirroring the back-office state machine (1.1).
    enum ActionType {
        SUSPEND,
        REVOKE,
        REINSTATE
    }

    /// @notice A certificate's standing on chain (DECISIONS.md D30). VALID is
    ///         the one a verifier accepts; SUSPENDED and REVOKED are both
    ///         "not valid" to it, and only REVOKED is for good.
    enum Standing {
        NONE,
        VALID,
        SUSPENDED,
        REVOKED
    }

    /// @notice What a policy governs: the three status transitions, whose
    ///         indexes it shares with ActionType, and the contract's own rules.
    enum PolicyKind {
        SUSPEND,
        REVOKE,
        REINSTATE,
        ADMIN
    }

    /// @notice The changes the contract makes to its own rules (component 10.4).
    enum AdminAction {
        ADD_SIGNER,
        REMOVE_SIGNER,
        REPLACE_SIGNER,
        SET_POLICY,
        SET_PROPOSAL_TTL
    }

    /// @notice What it takes to decide one kind of proposal.
    /// @param threshold Distinct roles that must sign.
    /// @param requiredRoleMask Roles that must be among them. Their number
    ///        cannot exceed the threshold.
    /// @param vetoRoleMask Roles whose keys may veto a proposal of this kind.
    ///        At least one of them must hold a key. The key that opened a
    ///        proposal may always withdraw it, whatever its role.
    /// @param timelock Seconds between quorum and execution.
    struct Policy {
        uint8 threshold;
        RoleSet requiredRoleMask;
        RoleSet vetoRoleMask;
        uint64 timelock;
    }

    /// @notice A change to the contract's own rules. Which fields matter
    ///         depends on the action.
    struct AdminChange {
        AdminAction action;
        address subject; // ADD, REMOVE and REPLACE_SIGNER: the key concerned
        address replacement; // REPLACE_SIGNER: the new key, which takes the old one's role
        Role role; // ADD_SIGNER: the new key's role
        PolicyKind kind; // SET_POLICY: which policy
        Policy policy; // SET_POLICY: its new value
        uint64 ttl; // SET_PROPOSAL_TTL
    }

    /// @notice A signer known by its DID rather than its key: any key the DID
    ///         Registry shows for `did` signs with `role`, so the key rotates
    ///         there and not here.
    struct Cosigner {
        string did;
        Role role;
    }

    /// @notice What the TAO sets up for a TI. Its accreditation is not kept:
    ///         the Trusted Issuers Registry answers that on every use.
    /// @param did The TI's DID.
    /// @param attributeId Its accreditation attribute in the registry.
    /// @param signers The TI's own keys, each a valid key of `did`.
    /// @param roles The role of each key, in the same order.
    /// @param cosigners The DIDs that sign from outside the TI.
    /// @param policies SUSPEND, REVOKE, REINSTATE and ADMIN.
    /// @param proposalTtl How long a proposal may stay open (0: forever).
    struct TiSetup {
        string did;
        bytes32 attributeId;
        address[] signers;
        Role[] roles;
        Cosigner[] cosigners;
        Policy[POLICY_KINDS] policies;
        uint64 proposalTtl;
    }

    struct ProposalView {
        bytes32 tiId;
        bytes32 statusKey;
        ActionType actionType;
        bytes32 reasonHash;
        uint64 proposedAt;
        uint64 quorumReachedAt;
        ProposalState state;
        address[] signatures;
        uint64 executableAt;
        RoleSet rolesSignedMask;
        address proposer;
    }

    struct AdminProposalView {
        bytes32 tiId;
        AdminChange change;
        uint64 proposedAt;
        uint64 quorumReachedAt;
        ProposalState state;
        address[] signatures;
        uint64 executableAt;
        RoleSet rolesSignedMask;
        address proposer;
    }

    /// @notice A certificate's record, as stored and as a verifier reads it
    ///         (D30, D36).
    /// @param validFrom When the certificate became valid.
    /// @param validUntil When it expires (0: never). The contract does not
    ///        compare either with the clock; a verifier does.
    /// @param credentialHash SHA-256 of the signed JWT as issued (D42). A
    ///        verifier refuses a credential whose JWT hashes to anything else.
    /// @param issuerDid The DID of the TI that issued it.
    struct Certificate {
        Standing standing;
        uint64 validFrom;
        uint64 validUntil;
        uint64 registeredAt;
        uint64 changedAt;
        bytes32 credentialHash;
        string issuerDid;
    }

    struct TiView {
        string did;
        bytes32 attributeId;
        address[] signers;
        Role[] roles;
        Cosigner[] cosigners;
        Policy[POLICY_KINDS] policies;
        uint64 proposalTtl;
        uint64 version;
        RoleSet rolesPresentMask;
    }

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error NotASigner();
    error AlreadySigned();
    error UnknownProposal();
    error ProposalNotOpen();
    error ProposalAlreadyOpen(uint256 existingProposalId);
    error QuorumNotReached();
    error TimelockNotElapsed(uint64 executableAt);
    error ProposalNotExpirable();
    error InvalidSigner();
    error DuplicateSigner();
    /// @notice The key was a signer once and was removed or replaced; it
    ///         cannot become one again.
    error SignerRetired();
    error InvalidRole();
    error InvalidPolicy();
    error InvalidTtl();
    error Unsatisfiable();
    error CannotVetoOwnRemoval();
    /// @notice The caller's role holds no veto under the policy, and the
    ///         caller did not open the proposal.
    error VetoNotAllowed();
    /// @notice A suspension or a revocation has to say why (DECISIONS.md D22).
    error ReasonRequired();
    /// @notice A certificate is recorded with the hash of its id, the hash of
    ///         the credential, and its TI.
    error IncompleteCertificate();
    /// @notice A certificate expires after it becomes valid, if ever.
    error InvalidValidity();
    error InvalidStanding();
    /// @notice The TI recorded a certificate with this id already.
    error CertificateAlreadyRegistered();
    error UnknownCertificate();
    /// @notice Only a valid certificate can be suspended at once.
    error CertificateNotValid();
    /// @notice A revoked certificate stays revoked.
    error CertificateRevoked();
    error InvalidTaoDid();
    /// @notice No TI is set up under this id.
    error UnknownTi();
    error TiAlreadyConfigured();
    /// @notice The registry does not show a live accreditation by this TAO.
    error TiNotActive();
    /// @notice The DID Registry does not show the key as a valid key of the DID.
    error NotDidController();
    error InvalidCosigner();
    /// @notice The certificate is another TI's.
    error NotCertificateIssuer();
    /// @notice A registry address has no contract behind it.
    error InvalidRegistry();
    /// @notice A governance address has no contract behind it.
    error InvalidGovernance();
    /// @notice Only the governance contract may do this.
    error NotGovernance();
    /// @notice A contract always has an owner; ownership is only transferred.
    error OwnershipNotRenounceable();
}
