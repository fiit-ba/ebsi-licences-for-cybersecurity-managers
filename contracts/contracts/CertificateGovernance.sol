// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ICertificateGovernance} from "./interfaces/ICertificateGovernance.sol";
import {StatusProposals} from "./governance/StatusProposals.sol";
import {RuleChanges} from "./governance/RuleChanges.sol";

/**
 * @title CertificateGovernance
 * @notice Multisig governance layer over certificate status changes
 *         (component 10 of the Professional License Registry specification).
 *
 * @dev Component 10's independently verifiable proof that a status change was
 *      approved by a quorum before it was carried out. The certificates
 *      themselves live in CertificateRegistry (D39), which a verifier reads
 *      without this contract; executed proposals set their standing there.
 *
 *      - The contract never calls the back-office; it watches
 *        `ProposalExecuted` (or polls) instead, so neither depends on the
 *        other being reachable.
 *      - Nothing here identifies a holder: a proposal carries only the
 *        certificate's `statusKey`, so it is linkable to that record, not to a
 *        holder (D40, D42).
 *
 *      Custom EBSI extension (component 10.0, subject to EBSI approval): EBSI
 *      deploys only pre-approved templates through its Smart Contracts
 *      Factory, which resolves a template's initializer via
 *      `getImplementationInitSelector` over ERC-165 (`supportsInterface`
 *      below) when supported. Reimplemented locally rather than depending on
 *      the factory's own code, since local/ebsi-mock is test/script-only and
 *      the prod build fails if anything under contracts/ imports it.
 *
 * @dev One contract for every TI of a TAO (D45). The TAO sets each TI up
 *      (`addTi`); the contract keeps its rules and no status: whether a TI is
 *      active is read from the Trusted Issuers Registry and whether a key is
 *      valid from the DID Registry, each time, so revoking there is enough.
 *      Each TI has its own signers, cosigners, policies and proposal lifetime.
 *
 * @dev Version 2 (D19): rules are data. Each signer holds one role
 *      (component 10.2: pilot's A/B/C); a quorum counts distinct roles, not
 *      keys; each action/rule-change has a `Policy` (threshold, required and
 *      veto roles, timelock); a rule change waits out ADMIN's timelock
 *      unless vetoed (the key it removes can't veto its own removal); a
 *      signature only counts while its key is still a signer, and an expired
 *      proposal can no longer be signed or executed. D21 added the V2
 *      commitment, typed roles, veto roles, timelock restart on regained
 *      quorum, retired keys, and the file split below.
 *
 * @dev Separation of duties in the back-office (component 1) and this
 *      multisig are NOT the same control (component 10.4): one is
 *      application-enforced, the other verifiable by a third party without
 *      trusting the certification body. They guard different threats.
 *
 * @dev Parts: governance/ holds the stateful modules, each with its own
 *      ERC-7201 namespace so a module can grow across an upgrade without
 *      moving another's storage: TiAccreditation (the EBSI registries, whether
 *      a TI is active), TiConfiguration (signers/roles/policies/TTL), Ballots
 *      (signing/quorum/timelock/veto/expiry), StatusProposals
 *      (suspend/revoke/reinstate, audit), RuleChanges
 *      (the contract's own rule changes). libraries/ holds stateless code:
 *      Roles (`Role`/`RoleSet`), Hashes, PolicyRules. interfaces/
 *      holds one interface per module, and IGovernanceTypes for what they
 *      share.
 */
contract CertificateGovernance is ICertificateGovernance, StatusProposals, RuleChanges, ERC165 {
    /// @dev `bytes4(keccak256("getImplementationInitSelector()"))`, EBSI's
    ///      Contracts Factory interface id for a beacon implementation that
    ///      advertises its own initializer selector.
    bytes4 private constant IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID = 0xf622b441;

    /**
     * @notice Locks the implementation against initialization/reinitialization
     * @dev Runs only behind a beacon proxy (D45), whose storage `initialize`
     *      sets up.
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Set up the proxy's owner and the registries it trusts, once, in
     *         the transaction that creates the proxy. TIs come after (`addTi`):
     *         one contract serves them all.
     * @param tao The contract's owner. Named, not taken from `msg.sender`,
     *        which is the Proxy Factory on a factory deployment.
     * @param taoDid_ The TAO's DID in the Trusted Issuers Registry.
     * @param didRegistry_ EBSI's DID Registry.
     * @param issuersRegistry_ EBSI's Trusted Issuers Registry.
     * @param certificateRegistry_ The registry of this TAO's certificates.
     */
    function initialize(
        address tao,
        string memory taoDid_,
        address didRegistry_,
        address issuersRegistry_,
        address certificateRegistry_
    ) external initializer {
        __Ownable_init(tao);
        _setRegistries(taoDid_, didRegistry_, issuersRegistry_);
        _setCertificateRegistry(certificateRegistry_);
    }

    /**
     * @notice The selector EBSI's Contracts Factory calls to initialize a
     *         proxy deployed against this implementation.
     */
    function getImplementationInitSelector() external pure returns (bytes4) {
        return this.initialize.selector;
    }

    /// @inheritdoc ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == IMPLEMENTATION_INIT_SELECTOR_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
}
