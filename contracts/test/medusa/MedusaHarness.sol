pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {CertificateGovernance} from "../../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../../contracts/CertificateRegistry.sol";
import {IGovernanceTypes, POLICY_KINDS} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../../contracts/interfaces/IEbsiRegistries.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {StubDidRegistry, StubIssuersRegistry} from "../RegistryStubs.sol";
import {GovernanceHandler} from "../invariant/GovernanceHandler.sol";

/**
 * test/invariant/ for Medusa, a coverage-guided fuzzer: the same handler, two
 * TIs on one contract, and the invariants as `property_` functions. Medusa
 * has no `setUp`, so the constructor deploys everything; it calls the
 * forwarding functions below in sequences of its own choosing.
 *
 *   medusa fuzz --config test/medusa/medusa.json
 *
 * Left out, as Medusa has no snapshots or recorded logs: the liveness
 * invariant and the event mirror (GovernanceInvariants.t.sol keeps both).
 */
contract MedusaHarness {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string private constant TAO_DID = "did:ebsi:zTao";
    string private constant ROOT_DID = "did:ebsi:zRoot";
    string private constant TI_DID = "did:ebsi:zvHWX359A3CvfJnCYaAiAde";
    string private constant OTHER_TI_DID = "did:ebsi:zOtherTi";
    bytes32 private constant ROOT_ATTRIBUTE = keccak256("root attribute");
    bytes32 private constant TAO_ATTRIBUTE = keccak256("tao attribute");
    bytes32 private constant TI_ATTRIBUTE = keccak256("ti attribute");
    bytes32 private constant CREDENTIAL_HASH = keccak256("credential");

    CertificateGovernance private immutable governance;
    CertificateRegistry private immutable registry;
    GovernanceHandler private immutable handler;

    constructor() {
        StubDidRegistry dids = new StubDidRegistry();
        StubIssuersRegistry issuers = new StubIssuersRegistry();
        issuers.accredit(ROOT_DID, ROOT_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.RootTAO, ROOT_DID, bytes32(0));
        issuers.accredit(TAO_DID, TAO_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TAO, ROOT_DID, ROOT_ATTRIBUTE);
        issuers.accredit(TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, TAO_DID, TAO_ATTRIBUTE);
        issuers.accredit(OTHER_TI_DID, TI_ATTRIBUTE, IEbsiIssuersRegistry.IssuerType.TI, TAO_DID, TAO_ATTRIBUTE);

        address tao = _addr("tao");
        UpgradeableBeacon beacon =
            new UpgradeableBeacon(address(new CertificateGovernance(address(dids), address(issuers))), address(this));
        UpgradeableBeacon registryBeacon = new UpgradeableBeacon(address(new CertificateRegistry()), address(this));
        registry = CertificateRegistry(
            address(new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (tao))))
        );
        governance = CertificateGovernance(
            address(
                new BeaconProxy(
                    address(beacon), abi.encodeCall(CertificateGovernance.initialize, (tao, TAO_DID, address(registry)))
                )
            )
        );
        vm.prank(tao);
        registry.setGovernance(address(governance));

        address[12] memory actors = [
            _addr("A"),
            _addr("B"),
            _addr("C"),
            _addr("D"),
            _addr("E"),
            _addr("F"),
            _addr("X"),
            _addr("Y"),
            _addr("S"),
            _addr("U"),
            _addr("outsider"),
            _addr("spare")
        ];
        _addTi(tao, TI_DID, _list(actors[0], actors[1], actors[2]), 3);
        _addTi(tao, OTHER_TI_DID, _list(actors[6], actors[7], address(0)), 2);

        handler = new GovernanceHandler(
            governance,
            registry,
            address(dids),
            address(issuers),
            [TI_DID, OTHER_TI_DID],
            TAO_DID,
            TAO_ATTRIBUTE,
            TI_ATTRIBUTE
        );
        for (uint256 i = 0; i < actors.length; i++) {
            handler.addActor(actors[i]);
        }
        handler.setTao(tao);
        beacon.transferOwnership(address(handler));
        registryBeacon.transferOwnership(address(handler));
        handler.setBeacons(beacon, registryBeacon);
        handler.addCosignerDid("did:ebsi:zSupervisor", actors[8]);
        handler.addCosignerDid("did:ebsi:zAuditor", actors[9]);
        handler.seedSigner(0, actors[0], 1);
        handler.seedSigner(0, actors[1], 2);
        handler.seedSigner(0, actors[2], 3);
        handler.seedSigner(1, actors[6], 1);
        handler.seedSigner(1, actors[7], 2);
        _register(actors[0], TI_DID, "urn:uuid:fixture", 0);
        _register(actors[1], TI_DID, "urn:uuid:other-fixture", 0);
        _register(actors[6], OTHER_TI_DID, "urn:uuid:fixture", 1);
    }

    // -----------------------------------------------------------------------
    // What Medusa calls: the handler's actions
    // -----------------------------------------------------------------------

    function propose(uint256 a, uint256 c, uint8 action, uint8 reason) external {
        handler.propose(a, c, action, reason);
    }

    function sign(uint256 a, uint256 p) external {
        handler.sign(a, p);
    }

    function execute(uint256 a, uint256 p) external {
        handler.execute(a, p);
    }

    function cancel(uint256 a, uint256 p) external {
        handler.cancel(a, p);
    }

    function expire(uint256 p) external {
        handler.expire(p);
    }

    function suspendNow(uint256 a, uint256 c) external {
        handler.suspendNow(a, c);
    }

    function proposeAddSigner(uint256 a, uint256 t, uint256 s, uint8 role) external {
        handler.proposeAddSigner(a, t, s, role);
    }

    function proposeRemoveSigner(uint256 a, uint256 t, uint256 s) external {
        handler.proposeRemoveSigner(a, t, s);
    }

    function proposeReplaceSigner(uint256 a, uint256 t, uint256 s, uint256 r) external {
        handler.proposeReplaceSigner(a, t, s, r);
    }

    function proposePolicy(uint256 a, uint256 t, uint8 kind, uint8 threshold, uint8 required, uint8 veto, uint64 lock)
        external
    {
        handler.proposePolicy(a, t, kind, threshold, required, veto, lock);
    }

    function proposeProposalTtl(uint256 a, uint256 t, uint64 ttl) external {
        handler.proposeProposalTtl(a, t, ttl);
    }

    function signAdmin(uint256 a, uint256 p) external {
        handler.signAdmin(a, p);
    }

    function executeAdmin(uint256 a, uint256 p) external {
        handler.executeAdmin(a, p);
    }

    function cancelAdmin(uint256 a, uint256 p) external {
        handler.cancelAdmin(a, p);
    }

    function expireAdmin(uint256 p) external {
        handler.expireAdmin(p);
    }

    function setCosigners(uint256 t, uint8 pick, uint8 r0, uint8 r1) external {
        handler.setCosigners(t, pick, r0, r1);
    }

    function toggleCosignerKey(uint256 seed) external {
        handler.toggleCosignerKey(seed);
    }

    function toggleKey(uint256 a, uint256 t) external {
        handler.toggleKey(a, t);
    }

    function toggleTi(uint256 t) external {
        handler.toggleTi(t);
    }

    function moveTi(uint256 t, uint256 attribute) external {
        handler.moveTi(t, attribute);
    }

    function upgrade(uint256 seed) external {
        handler.upgrade(seed);
    }

    function registerCertificate(uint256 a, uint256 t, uint8 id, uint64 from, uint64 until, uint8 standing) external {
        handler.registerCertificate(a, t, id, from, until, standing);
    }

    function wait(uint256 seconds_) external {
        handler.wait(seconds_);
    }

    // -----------------------------------------------------------------------
    // Properties: the invariants of GovernanceInvariants.t.sol
    // -----------------------------------------------------------------------

    /// No successful call broke a rule the handler checks, and every call
    /// did what the model expected.
    function property_NoCallBrokeARule() external view returns (bool) {
        return handler.violationCount() == 0;
    }

    function property_EveryStandingIsTheDecidedOne() external view returns (bool) {
        for (uint256 i = 0; i < handler.certificateCount(); i++) {
            bytes32 key = handler.certificates(i);
            if (registry.certificateStatus(key).standing != handler.ghostStanding(key)) return false;
        }
        return true;
    }

    function property_EveryKeyHasTheDecidedRole() external view returns (bool) {
        for (uint256 ti = 0; ti < 2; ti++) {
            bytes32 id = handler.tiId(ti);
            for (uint256 i = 0; i < handler.actorCount(); i++) {
                address actor = handler.actors(i);
                if (Role.unwrap(governance.roleOf(id, actor)) != handler.expectedRole(ti, actor)) return false;
                if (governance.retired(id, actor) != handler.ghostRetired(ti, actor)) return false;
            }
        }
        return true;
    }

    function property_OneOpenProposalPerCertificate() external view returns (bool) {
        for (uint256 i = 0; i < handler.certificateCount(); i++) {
            bytes32 key = handler.certificates(i);
            uint256 open;
            for (uint256 id = 1; id <= governance.proposalCount(); id++) {
                if (governance.getProposal(id).statusKey != key) continue;
                IGovernanceTypes.ProposalState state = governance.stateOf(id);
                if (
                    state == IGovernanceTypes.ProposalState.PROPOSED || state == IGovernanceTypes.ProposalState.APPROVED
                ) open++;
            }
            if (open > 1) return false;
        }
        return true;
    }

    function property_EveryPolicyStaysReachable() external view returns (bool) {
        for (uint256 ti = 0; ti < 2; ti++) {
            IGovernanceTypes.TiView memory view_ = governance.getTi(handler.tiId(ti));
            uint8 present = RoleSet.unwrap(view_.rolesPresentMask);
            if (view_.proposalTtl > governance.MAX_PROPOSAL_TTL()) return false;
            for (uint256 kind = 0; kind < POLICY_KINDS; kind++) {
                IGovernanceTypes.Policy memory p = view_.policies[kind];
                uint8 required = RoleSet.unwrap(p.requiredRoleMask);
                if (p.timelock > governance.MAX_TIMELOCK() || p.threshold == 0) return false;
                if (view_.proposalTtl < p.timelock + governance.MIN_SIGNING_WINDOW()) return false;
                if (_count(required) > p.threshold || _count(present) < p.threshold) return false;
                if (present & required != required || present & RoleSet.unwrap(p.vetoRoleMask) == 0) return false;
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------

    /// The pilot's rules (config/pilot.json): 2 of the roles for everything,
    /// a day's timelock on revocation, any role vetoes, 30 days to decide.
    function _addTi(address tao, string memory did, address[3] memory keys, uint256 n) private {
        address[] memory signers = new address[](n);
        Role[] memory roles = new Role[](n);
        for (uint256 i = 0; i < n; i++) {
            signers[i] = keys[i];
            roles[i] = Role.wrap(uint8(i + 1));
        }
        IGovernanceTypes.Policy[POLICY_KINDS] memory policies;
        for (uint256 kind = 0; kind < POLICY_KINDS; kind++) {
            policies[kind] = IGovernanceTypes.Policy(2, RoleSet.wrap(0), RoleSet.wrap(0x07), kind == 1 ? 1 days : 0);
        }
        vm.prank(tao);
        governance.addTi(
            IGovernanceTypes.TiSetup(
                did, TI_ATTRIBUTE, signers, roles, new IGovernanceTypes.Cosigner[](0), policies, 30 days
            )
        );
    }

    function _register(address by, string memory did, string memory id, uint8 ti) private {
        bytes32 idHash = Hashes.certificateIdHash(id);
        vm.prank(by);
        bytes32 key = registry.registerCertificate(idHash, did, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        handler.addCertificate(key, ti);
    }

    function _addr(string memory name) private pure returns (address) {
        return vm.addr(uint256(keccak256(bytes(name))));
    }

    function _list(address a, address b, address c) private pure returns (address[3] memory) {
        return [a, b, c];
    }

    function _count(uint8 bits) private pure returns (uint8 n) {
        for (; bits != 0; bits &= bits - 1) {
            n++;
        }
    }
}
