// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
import {IEbsiIssuersRegistry} from "../contracts/interfaces/IEbsiRegistries.sol";
import {GovernanceConfigFile} from "../scripts/GovernanceConfigFile.sol";
import {StubDidRegistry, StubIssuersRegistry} from "./RegistryStubs.sol";

/**
 * The contract as the tests deploy it: the pilot's three roles, one key each,
 * and the pilot's policies (config/pilot.json) unless a test changes one.
 */
abstract contract GovernanceTest is Test, GovernanceConfigFile {
    uint64 internal constant HOUR = 1 hours;
    uint64 internal constant DAY = 1 days;

    string internal constant TI_DID = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    bytes32 internal constant TI_ID = keccak256(bytes(TI_DID));
    string internal constant ROOT_DID = "did:ebsi:zRoot";
    bytes32 internal constant ROOT_ATTRIBUTE = keccak256("root attribute");
    bytes32 internal constant TAO_ATTRIBUTE = keccak256("tao attribute");
    bytes32 internal constant TI_ATTRIBUTE = keccak256("ti attribute");

    // A: the certification body's decision maker
    // B: its independent second approver
    // C: the supervisory authority (NBÚ), external
    Role internal constant ROLE_A = Role.wrap(1);
    Role internal constant ROLE_B = Role.wrap(2);
    Role internal constant ROLE_C = Role.wrap(3);
    RoleSet internal constant NONE = RoleSet.wrap(0);
    RoleSet internal constant ALL = RoleSet.wrap(0x07);

    /// A reason commitment for tests that are about something else (D22). A
    /// real one is computeReasonHash(category, note, salt); NO_REASON is the
    /// zero hash, which only a reinstatement may give.
    bytes32 internal constant REASON_GIVEN = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;
    bytes32 internal constant NO_REASON = bytes32(0);

    bytes32 internal constant CREDENTIAL_HASH = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant OTHER_CREDENTIAL_HASH = 0x2222222222222222222222222222222222222222222222222222222222222222;
    /// What a veto records as its reason (a digest of the off-chain record).
    bytes32 internal constant REASON = 0xabababababababababababababababababababababababababababababababab;

    address internal tao;
    string internal taoDid = "did:ebsi:zTao";
    address internal didRegistry;
    address internal issuersRegistry;
    StubIssuersRegistry internal issuers;
    address internal A;
    address internal B;
    address internal C;
    address internal outsider;
    address internal spare;

    /// The pilot's policies, by PolicyKind, and its proposal lifetime.
    IGovernanceTypes.Policy[4] internal pilot;
    uint64 internal pilotTtl;

    CertificateGovernance internal governance;
    /// The registry of the contract `deploy` made last.
    CertificateRegistry internal registry;

    /// Two certificates of the TI, on record in every contract `deploy` makes,
    /// for tests that are about something else: a proposal needs a record.
    bytes32 internal CERTIFICATE;
    bytes32 internal OTHER_CERTIFICATE;
    // Computed ahead: sha256 is a call, and would take a pending prank.
    bytes32 private certificateIdHash;
    bytes32 private otherCertificateIdHash;

    /// The implementation and the beacon every proxy of a test follows; this
    /// test contract owns the beacon.
    ///
    /// Deliberately OpenZeppelin's plain UpgradeableBeacon/BeaconProxy, not
    /// EBSI's VersionedUpgradeableBeacon/VersionedBeaconProxy that
    /// scripts/Deploy.s.sol now deploys behind: this file has no `.t.sol`
    /// suffix, so `FOUNDRY_PROFILE=prod forge build --skip test --skip
    /// script` compiles it (unlike the `.t.sol` suites that use it), and the
    /// prod profile has no remapping for ebsi-mock/ (foundry.toml). Coverage
    /// for the versioned beacon lives in a `.t.sol` file instead
    /// (test/EbsiBeacon.t.sol).
    CertificateGovernance internal implementation;
    UpgradeableBeacon internal beacon;
    UpgradeableBeacon internal registryBeacon;
    CertificateGovernance private nextProxy;

    function setUp() public virtual {
        implementation = new CertificateGovernance();
        beacon = new UpgradeableBeacon(address(implementation), address(this));
        registryBeacon = new UpgradeableBeacon(address(new CertificateRegistry()), address(this));
        tao = makeAddr("tao");
        didRegistry = address(new StubDidRegistry());
        issuers = new StubIssuersRegistry();
        issuersRegistry = address(issuers);
        _accredit(ROOT_DID, ROOT_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.RootTAO, ROOT_DID, bytes32(0));
        _accredit(taoDid, TAO_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TAO, ROOT_DID, ROOT_ATTRIBUTE);
        accreditTi(TI_DID);
        nextProxy = _newProxy();
        A = makeAddr("A");
        B = makeAddr("B");
        C = makeAddr("C");
        outsider = makeAddr("outsider");
        spare = makeAddr("spare");
        IGovernanceTypes.Policy[4] memory policies;
        (policies, pilotTtl) = _readConfig("config/pilot.json");
        for (uint256 i = 0; i < 4; i++) {
            pilot[i] = policies[i];
        }
        certificateIdHash = Hashes.certificateIdHash("urn:uuid:fixture");
        otherCertificateIdHash = Hashes.certificateIdHash("urn:uuid:other-fixture");
        CERTIFICATE = Hashes.statusKey(TI_DID, certificateIdHash);
        OTHER_CERTIFICATE = Hashes.statusKey(TI_DID, otherCertificateIdHash);
        governance = deploy(pilotPolicies());
    }

    // -----------------------------------------------------------------------
    // Deployment
    // -----------------------------------------------------------------------

    /// The contract with a TI set up in it: A, B and C with their roles, under
    /// `policies`, with the pilot's lifetime.
    function deploy(IGovernanceTypes.Policy[4] memory policies) internal returns (CertificateGovernance) {
        return deploy(keys(A, B, C), roles(ROLE_A, ROLE_B, ROLE_C), policies, pilotTtl);
    }

    function deploy(
        address[] memory signers,
        Role[] memory signerRoles,
        IGovernanceTypes.Policy[4] memory policies,
        uint64 ttl
    ) internal returns (CertificateGovernance) {
        // One call, addTi: a test that expects the setup to revert expects it
        // of this call, so the proxy is made ahead.
        CertificateGovernance deployed = nextProxy;
        vm.prank(tao);
        deployed.addTi(setup(TI_DID, signers, signerRoles, policies, ttl));
        nextProxy = _newProxy();
        registry = CertificateRegistry(deployed.certificateRegistry());
        if (signers.length > 0) {
            _recordFixture(signers[0], certificateIdHash, CREDENTIAL_HASH);
            _recordFixture(signers[0], otherCertificateIdHash, OTHER_CREDENTIAL_HASH);
        }
        return deployed;
    }

    /// Does nothing when the TI could not be set up: a test expected that.
    function _recordFixture(address by, bytes32 idHash, bytes32 credentialHash) private {
        vm.prank(by);
        try registry.registerCertificate(idHash, TI_DID, 1, 0, credentialHash, IGovernanceTypes.Standing.VALID) {}
        catch {}
    }

    function setup(
        string memory did,
        address[] memory signers,
        Role[] memory signerRoles,
        IGovernanceTypes.Policy[4] memory policies,
        uint64 ttl
    ) internal pure returns (IGovernanceTypes.TiSetup memory) {
        return IGovernanceTypes.TiSetup(
            did, TI_ATTRIBUTE, signers, signerRoles, new IGovernanceTypes.Cosigner[](0), policies, ttl
        );
    }

    /// A TI accredited by this contract's TAO.
    function accreditTi(string memory did) internal {
        _accredit(did, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
    }

    function _accredit(
        string memory did,
        bytes32 attributeId,
        IEbsiIssuersRegistry.IssuerType kind,
        string memory parent,
        bytes32 parentAttribute
    ) private {
        issuers.accredit(did, attributeId, kind, parent, parentAttribute);
    }

    function _newProxy() private returns (CertificateGovernance deployed) {
        CertificateRegistry certificates = CertificateRegistry(
            address(new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (tao))))
        );
        bytes memory init = abi.encodeCall(
            CertificateGovernance.initialize, (tao, taoDid, didRegistry, issuersRegistry, address(certificates))
        );
        deployed = CertificateGovernance(address(new BeaconProxy(address(beacon), init)));
        vm.prank(tao);
        certificates.setGovernance(address(deployed));
    }


    /// A copy of the pilot's policies, for a test to change one of.
    function pilotPolicies() internal view returns (IGovernanceTypes.Policy[4] memory policies) {
        for (uint256 i = 0; i < 4; i++) {
            policies[i] = pilot[i];
        }
    }

    /// The pilot's policies with one of them replaced.
    function pilotWith(IGovernanceTypes.PolicyKind kind, IGovernanceTypes.Policy memory replacement)
        internal
        view
        returns (IGovernanceTypes.Policy[4] memory policies)
    {
        policies = pilotPolicies();
        policies[uint8(kind)] = replacement;
    }

    function policy(uint8 threshold, RoleSet required, RoleSet veto, uint64 timelock)
        internal
        pure
        returns (IGovernanceTypes.Policy memory)
    {
        return IGovernanceTypes.Policy(threshold, required, veto, timelock);
    }

    // -----------------------------------------------------------------------
    // Acting
    // -----------------------------------------------------------------------

    function propose(address by, bytes32 statusKey, IGovernanceTypes.ActionType action, bytes32 reasonHash)
        internal
        returns (uint256 id)
    {
        vm.prank(by);
        id = governance.proposeAction(TI_ID, statusKey, action, reasonHash);
    }

    function sign(uint256 id, address by) internal {
        vm.prank(by);
        governance.signProposal(id);
    }

    function execute(uint256 id, address by) internal {
        vm.prank(by);
        governance.execute(id);
    }

    function cancel(uint256 id, address by, bytes32 reasonHash) internal {
        vm.prank(by);
        governance.cancelProposal(id, reasonHash);
    }

    function signAdmin(uint256 id, address by) internal {
        vm.prank(by);
        governance.signAdminProposal(id);
    }

    function executeAdmin(uint256 id, address by) internal {
        vm.prank(by);
        governance.executeAdminProposal(id);
    }

    function cancelAdmin(uint256 id, address by) internal {
        vm.prank(by);
        governance.cancelAdminProposal(id);
    }

    // Rule changes, proposed by `by` and signed by `cosigner`; each returns
    // the change's id.

    function addSigner(address by, address cosigner, address signer, Role role) internal returns (uint256 id) {
        vm.prank(by);
        id = governance.proposeAddSigner(TI_ID, signer, role);
        signAdmin(id, cosigner);
    }

    function removeSigner(address by, address cosigner, address signer) internal returns (uint256 id) {
        vm.prank(by);
        id = governance.proposeRemoveSigner(TI_ID, signer);
        signAdmin(id, cosigner);
    }

    function replaceSigner(address by, address cosigner, address signer, address replacement)
        internal
        returns (uint256 id)
    {
        vm.prank(by);
        id = governance.proposeReplaceSigner(TI_ID, signer, replacement);
        signAdmin(id, cosigner);
    }

    function setPolicy(
        address by,
        address cosigner,
        IGovernanceTypes.PolicyKind kind,
        IGovernanceTypes.Policy memory p
    ) internal returns (uint256 id) {
        vm.prank(by);
        id = governance.proposePolicy(TI_ID, kind, p.threshold, p.requiredRoleMask, p.vetoRoleMask, p.timelock);
        signAdmin(id, cosigner);
    }

    function setTtl(address by, address cosigner, uint64 ttl) internal returns (uint256 id) {
        vm.prank(by);
        id = governance.proposeProposalTtl(TI_ID, ttl);
        signAdmin(id, cosigner);
    }

    // -----------------------------------------------------------------------
    // Checking
    // -----------------------------------------------------------------------

    function assertState(uint256 id, IGovernanceTypes.ProposalState expected) internal view {
        assertEq(uint8(governance.stateOf(id)), uint8(expected), "proposal state");
    }

    function assertAdminState(uint256 id, IGovernanceTypes.ProposalState expected) internal view {
        assertEq(uint8(governance.adminStateOf(id)), uint8(expected), "rule change state");
    }

    function assertEq(RoleSet actual, RoleSet expected, string memory what) internal pure {
        assertEq(RoleSet.unwrap(actual), RoleSet.unwrap(expected), what);
    }

    // -----------------------------------------------------------------------
    // Small values
    // -----------------------------------------------------------------------

    function keys(address a, address b, address c) internal pure returns (address[] memory list) {
        list = new address[](3);
        (list[0], list[1], list[2]) = (a, b, c);
    }

    function keys(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        (list[0], list[1]) = (a, b);
    }

    function roles(Role a, Role b, Role c) internal pure returns (Role[] memory list) {
        list = new Role[](3);
        (list[0], list[1], list[2]) = (a, b, c);
    }

    function roles(Role a, Role b) internal pure returns (Role[] memory list) {
        list = new Role[](2);
        (list[0], list[1]) = (a, b);
    }

    function only(Role role) internal pure returns (RoleSet) {
        return role.toSet();
    }

    function both(Role a, Role b) internal pure returns (RoleSet) {
        return a.toSet().with(b);
    }
}
