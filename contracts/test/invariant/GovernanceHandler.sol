pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {CertificateGovernance} from "../../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../../contracts/CertificateRegistry.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {IEbsiIssuersRegistry} from "../../contracts/interfaces/IEbsiRegistries.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {StubDidRegistry, StubIssuersRegistry} from "../RegistryStubs.sol";
import {EventMirror} from "./EventMirror.sol";

/**
 * What the invariant fuzzer may do to two TIs of one contract: any of their
 * keys (and keys that are not theirs) proposes, signs, executes, vetoes and
 * changes the rules, the TAO changes their cosigners and moves them to
 * another accreditation, both contracts are upgraded, while keys are revoked
 * and restored in the DID Registry, a TI loses and regains its
 * accreditation, and time passes.
 *
 * Every call may revert; the handler swallows it. What it keeps is a model
 * of what the contract should hold (the "ghosts": each key's role, each
 * certificate's standing, each finished proposal's state), built from
 * what succeeded, and a list of the rules a successful call broke.
 */
contract GovernanceHandler is Test {
    using {_has} for uint8;

    CertificateGovernance public immutable governance;
    CertificateRegistry public immutable registry;
    StubDidRegistry private immutable dids;
    StubIssuersRegistry private immutable issuers;

    string[2] private tiDid;
    bytes32[2] public tiId;
    string private taoDid;
    bytes32 private taoAttribute;
    bytes32 private tiAttribute;
    address private tao;
    /// The beacons both contracts follow; the handler owns them.
    UpgradeableBeacon private governanceBeacon;
    UpgradeableBeacon private registryBeacon;

    /// The attributes a TI may be accredited under: the one it starts with,
    /// a second one, and one the registry never shows.
    bytes32[3] private attributes;

    /// DIDs outside the TIs that the TAO may make their cosigners, each
    /// controlled by one key of `actors` and no other.
    string[] private cosignerDid;
    address[] private cosignerOwner;

    /// Every key the fuzzer acts with: the TIs' keys, keys a rule change may
    /// add, and one that is never anyone's.
    address[] public actors;
    bytes32[] public certificates;
    /// Which TI issued each certificate.
    uint8[] private issuerOf;

    // Ghosts -------------------------------------------------------------------

    mapping(uint256 => mapping(address => uint8)) private ghostRole;
    mapping(uint256 => mapping(address => bool)) public ghostRetired;
    mapping(uint256 => mapping(address => bool)) private keyRevoked;
    /// The role each cosigner DID signs a TI's proposals with; 0 for none.
    mapping(uint256 => mapping(uint256 => uint8)) private ghostCosignerRole;
    mapping(uint256 => bool) private cosignerKeyRevoked;
    /// Whether each TI's attribute shows it as a TI, and the one it is under.
    mapping(uint256 => mapping(uint256 => bool)) private attributeActive;
    uint256[2] private currentAttribute;
    mapping(bytes32 => IGovernanceTypes.Standing) public ghostStanding;
    /// Every key on record, from the set-up or registered during the run.
    mapping(bytes32 => bool) private registered;
    mapping(uint256 => IGovernanceTypes.ProposalState) private finished;
    mapping(uint256 => IGovernanceTypes.ProposalState) private adminFinished;
    mapping(uint256 => bool) private applied;
    /// Proposals and rule changes closed in storage (executed, cancelled,
    /// expired), as opposed to past their lifetime but not yet marked.
    mapping(uint256 => bool) private closed;
    mapping(uint256 => bool) private adminClosed;

    /// What `_outcome` is told to expect: success, or for a rule change that
    /// gets applied, success or one of the errors of a change no longer
    /// valid against the configuration.
    bytes4 private constant OK = bytes4(0);
    bytes4 private constant VALID_OR_INVALIDATED = bytes4(keccak256("valid, or invalidated"));

    /// What the events of every call tell a reader (EventMirror).
    EventMirror public mirror;

    string[] private violations;
    /// Successful calls, by name, to see that the run did something.
    mapping(string => uint256) public successes;

    constructor(
        CertificateGovernance governance_,
        CertificateRegistry registry_,
        address dids_,
        address issuers_,
        string[2] memory tiDid_,
        string memory taoDid_,
        bytes32 taoAttribute_,
        bytes32 tiAttribute_
    ) {
        governance = governance_;
        registry = registry_;
        dids = StubDidRegistry(dids_);
        issuers = StubIssuersRegistry(issuers_);
        tiDid = tiDid_;
        tiId[0] = keccak256(bytes(tiDid_[0]));
        tiId[1] = keccak256(bytes(tiDid_[1]));
        taoDid = taoDid_;
        taoAttribute = taoAttribute_;
        tiAttribute = tiAttribute_;
        attributes = [tiAttribute_, keccak256("ti attribute, renewed"), keccak256("never accredited")];
        for (uint256 ti = 0; ti < 2; ti++) {
            attributeActive[ti][0] = true;
        }
    }

    // -------------------------------------------------------------------------
    // Set up by the test, not called by the fuzzer
    // -------------------------------------------------------------------------

    function addActor(address actor) external {
        actors.push(actor);
    }

    /// Seeded by the test with the events of its set-up.
    function setMirror(EventMirror mirror_) external {
        mirror = mirror_;
    }

    /// The events of one call reach the mirror, and only those: logs left
    /// over from elsewhere (the liveness invariant, undone) are dropped.
    /// Without a mirror (test/medusa/, whose fuzzer records no logs) the
    /// handler reads none.
    modifier observed() {
        if (address(mirror) == address(0)) {
            _;
        } else {
            vm.getRecordedLogs();
            vm.recordLogs();
            _;
            mirror.consume(vm.getRecordedLogs());
        }
    }

    function _dropLogs() private view {
        if (address(mirror) != address(0)) vm.getRecordedLogs();
    }

    function setTao(address tao_) external {
        tao = tao_;
    }

    /// After the test hands the handler both beacons.
    function setBeacons(UpgradeableBeacon governanceBeacon_, UpgradeableBeacon registryBeacon_) external {
        governanceBeacon = governanceBeacon_;
        registryBeacon = registryBeacon_;
    }

    /// After every actor is added: the stub lets any key control any DID,
    /// so all but `owner` are taken off this one.
    function addCosignerDid(string calldata did, address owner) external {
        cosignerDid.push(did);
        cosignerOwner.push(owner);
        for (uint256 i = 0; i < actors.length; i++) {
            if (actors[i] != owner) dids.setController(bytes(did), actors[i], false);
        }
    }

    function seedSigner(uint256 ti, address signer, uint8 role) external {
        ghostRole[ti][signer] = role;
    }

    function addCertificate(bytes32 statusKey, uint8 ti) external {
        _track(statusKey, ti, IGovernanceTypes.Standing.VALID);
    }

    function _track(bytes32 statusKey, uint8 ti, IGovernanceTypes.Standing standing) private {
        certificates.push(statusKey);
        issuerOf.push(ti);
        ghostStanding[statusKey] = standing;
        registered[statusKey] = true;
    }

    // -------------------------------------------------------------------------
    // Issuing
    // -------------------------------------------------------------------------

    /// A certificate issued during the run: mostly a valid one by a signer
    /// of its TI, under one of sixteen ids per TI so that some come twice;
    /// now and then suspended or revoked from the start, with a period that
    /// ends before it begins, no standing, or no credential hash.
    function registerCertificate(
        uint256 actorSeed,
        uint256 tiSeed,
        uint8 idSeed,
        uint64 validFrom,
        uint64 validUntil,
        uint8 standingSeed
    ) external observed {
        uint8 ti = uint8(tiSeed % 2);
        address actor = _actorFor(ti, actorSeed);
        // Ahead of the prank: sha256 is a call.
        bytes32 idHash = Hashes.certificateIdHash(string.concat("urn:uuid:fuzz-", vm.toString(idSeed % 16)));
        bytes32 key = Hashes.statusKey(tiDid[ti], idHash);
        uint64 from = uint64(bound(validFrom, 1, 3e9));
        uint64 until = validUntil % 8 == 7
            ? uint64(bound(validUntil >> 3, 1, from))
            : validUntil % 2 == 0 ? 0 : from + 1 + uint64(bound(validUntil >> 3, 0, 1e9));
        uint8 s = standingSeed % 16;
        IGovernanceTypes.Standing standing = s == 15
            ? IGovernanceTypes.Standing.NONE
            : s >= 13
                ? IGovernanceTypes.Standing.REVOKED
                : s >= 11 ? IGovernanceTypes.Standing.SUSPENDED : IGovernanceTypes.Standing.VALID;
        bytes32 credential = (standingSeed >> 4) == 15 ? bytes32(0) : keccak256(abi.encode(key, from));
        bytes4 expected = _expectRegister(ti, actor, key, until != 0 && until <= from, standing, credential);
        vm.prank(actor);
        try registry.registerCertificate(idHash, tiDid[ti], from, until, credential, standing) returns (bytes32 got) {
            successes["registerCertificate"]++;
            if (got != key) _violate("registered under another key");
            _track(key, ti, standing);
            _outcome("registerCertificate", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs();
            _outcome("registerCertificate", expected, false, err);
        }
        _sweep();
    }

    // -------------------------------------------------------------------------
    // Status proposals
    //
    // Each action works out from the model what the call should do (succeed,
    // or revert with which error), and `_outcome` compares: a refused valid
    // call is as much a violation as an accepted invalid one.
    // -------------------------------------------------------------------------

    /// Mostly a signer of the certificate's own TI with a reason; now and
    /// then another TI, any key, or no reason. The rare cases are on a seed
    /// other than 0, which the fuzzer gives often.
    function propose(uint256 actorSeed, uint256 certificateSeed, uint8 action, uint8 reasonSeed) external observed {
        uint256 c = certificateSeed % certificates.length;
        uint256 ti = (certificateSeed >> 8) % 16 == 15 ? 1 - issuerOf[c] : issuerOf[c];
        address actor = _actorFor(ti, actorSeed);
        IGovernanceTypes.ActionType actionType = IGovernanceTypes.ActionType(action % 3);
        bytes32 reason = reasonSeed % 8 == 7 ? bytes32(0) : keccak256(abi.encode(actorSeed, certificateSeed));
        bytes32 key = certificates[c];
        bytes4 expected = _expectPropose(ti, c, actionType, reason, actor);
        uint256 previous = governance.openProposalFor(key);
        vm.prank(actor);
        try governance.proposeAction(tiId[ti], key, actionType, reason) {
            successes["propose"]++;
            if (previous != 0) closed[previous] = true; // past its lifetime, expired by this one
            _outcome("propose", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("propose", expected, false, err);
        }
        _sweep();
    }

    function sign(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _proposal(proposalSeed);
        if (id == 0) return;
        uint256 ti = _tiOf(governance.getProposal(id).tiId);
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = !_isOpen(governance.stateOf(id))
            ? IGovernanceTypes.ProposalNotOpen.selector
            : _role(ti, actor) == 0
                ? IGovernanceTypes.NotASigner.selector
                : governance.hasSigned(id, actor) ? IGovernanceTypes.AlreadySigned.selector : OK;
        vm.prank(actor);
        try governance.signProposal(id) {
            successes["sign"]++;
            _outcome("sign", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("sign", expected, false, err);
        }
        _sweep();
    }

    function execute(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _approvedProposal(proposalSeed);
        if (id == 0) return;
        IGovernanceTypes.ProposalView memory p = governance.getProposal(id);
        uint256 ti = _tiOf(p.tiId);
        address actor = _actorFor(ti, actorSeed);
        IGovernanceTypes.Policy memory policy =
            governance.getPolicy(p.tiId, IGovernanceTypes.PolicyKind(uint8(p.actionType)));
        bytes4 expected = _expectExecute(ti, actor, p.state, p.signatures, p.quorumReachedAt, policy, false);
        IGovernanceTypes.Standing before = ghostStanding[p.statusKey];
        vm.prank(actor);
        try governance.execute(id) {
            successes["execute"]++;
            _outcome("execute", expected, true, "");
            _checkDecided(ti, p.state, p.signatures, p.quorumReachedAt, policy);
            if (before == IGovernanceTypes.Standing.REVOKED) _violate("a revoked certificate changed");
            closed[id] = true;
            ghostStanding[p.statusKey] = p.actionType == IGovernanceTypes.ActionType.REVOKE
                ? IGovernanceTypes.Standing.REVOKED
                : p.actionType == IGovernanceTypes.ActionType.SUSPEND
                    ? IGovernanceTypes.Standing.SUSPENDED
                    : IGovernanceTypes.Standing.VALID;
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("execute", expected, false, err);
        }
        _sweep();
    }

    function cancel(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _proposal(proposalSeed);
        if (id == 0) return;
        IGovernanceTypes.ProposalView memory p = governance.getProposal(id);
        uint256 ti = _tiOf(p.tiId);
        address actor = _actorFor(ti, actorSeed);
        RoleSet veto = governance.getPolicy(p.tiId, IGovernanceTypes.PolicyKind(uint8(p.actionType))).vetoRoleMask;
        bytes4 expected = _expectCancel(ti, actor, p.state, p.proposer, veto, false);
        vm.prank(actor);
        try governance.cancelProposal(id, keccak256("veto")) {
            successes["cancel"]++;
            closed[id] = true;
            _outcome("cancel", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("cancel", expected, false, err);
        }
        _sweep();
    }

    /// Anyone may record an expiry, once the proposal's lifetime is over
    /// and nothing else closed it first.
    function expire(uint256 proposalSeed) external observed {
        uint256 id = _proposal(proposalSeed);
        if (id == 0) return;
        bytes4 expected = _expectExpire(closed[id], governance.stateOf(id));
        try governance.expireProposal(id) {
            successes["expire"]++;
            closed[id] = true;
            _outcome("expire", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("expire", expected, false, err);
        }
        _sweep();
    }

    function suspendNow(uint256 actorSeed, uint256 certificateSeed) external observed {
        uint256 c = certificateSeed % certificates.length;
        address actor = _actorFor(issuerOf[c], actorSeed);
        bytes32 key = certificates[c];
        bytes4 expected = _role(issuerOf[c], actor) == 0
            ? IGovernanceTypes.NotASigner.selector
            : ghostStanding[key] != IGovernanceTypes.Standing.VALID ? IGovernanceTypes.CertificateNotValid.selector : OK;
        vm.prank(actor);
        try registry.suspendNow(key, keccak256("urgent")) {
            successes["suspendNow"]++;
            ghostStanding[key] = IGovernanceTypes.Standing.SUSPENDED;
            _outcome("suspendNow", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("suspendNow", expected, false, err);
        }
        _sweep();
    }

    // -------------------------------------------------------------------------
    // Rule changes
    //
    // Whether a change is valid against the configuration is the contract's
    // own judgement (RuleChanges._requireValid); the model checks who may
    // propose, and that what the contract applied keeps every policy
    // reachable (invariant_EveryPolicyStaysReachable).
    // -------------------------------------------------------------------------

    function proposeAddSigner(uint256 actorSeed, uint256 tiSeed, uint256 subjectSeed, uint8 role) external observed {
        uint256 ti = tiSeed % 2;
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = _expectProposeAdmin(ti, actor);
        vm.prank(actor);
        try governance.proposeAddSigner(
            tiId[ti], _newSigner(subjectSeed), Role.wrap(uint8(bound(role, 1, 4)))
        ) returns (
            uint256 id
        ) {
            _proposedAdmin(ti, actor, id, expected);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("proposeAdmin", expected, false, err);
        }
        _sweep();
    }

    function proposeRemoveSigner(uint256 actorSeed, uint256 tiSeed, uint256 subjectSeed) external observed {
        uint256 ti = tiSeed % 2;
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = _expectProposeAdmin(ti, actor);
        vm.prank(actor);
        try governance.proposeRemoveSigner(tiId[ti], _actorFor(ti, subjectSeed)) returns (uint256 id) {
            _proposedAdmin(ti, actor, id, expected);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("proposeAdmin", expected, false, err);
        }
        _sweep();
    }

    function proposeReplaceSigner(uint256 actorSeed, uint256 tiSeed, uint256 subjectSeed, uint256 replacementSeed)
        external
        observed
    {
        uint256 ti = tiSeed % 2;
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = _expectProposeAdmin(ti, actor);
        vm.prank(actor);
        try governance.proposeReplaceSigner(tiId[ti], _actorFor(ti, subjectSeed), _newSigner(replacementSeed)) returns (
            uint256 id
        ) {
            _proposedAdmin(ti, actor, id, expected);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("proposeAdmin", expected, false, err);
        }
        _sweep();
    }

    /// Mostly a policy the roles present can meet (a threshold of one to
    /// three, nothing required, any role vetoes), so that changes pass;
    /// the rare cases on seeds other than 0.
    function proposePolicy(
        uint256 actorSeed,
        uint256 tiSeed,
        uint8 kind,
        uint8 threshold,
        uint8 required,
        uint8 veto,
        uint64 timelock
    ) external observed {
        uint256 ti = tiSeed % 2;
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = _expectProposeAdmin(ti, actor);
        vm.prank(actor);
        try governance.proposePolicy(
            tiId[ti],
            IGovernanceTypes.PolicyKind(kind % 4),
            threshold % 8 == 7 ? uint8(bound(threshold >> 3, 0, 4)) : 1 + threshold % 3,
            RoleSet.wrap(required % 4 == 3 ? (required >> 2) & 0x0f : 0),
            RoleSet.wrap(veto % 8 == 7 ? (veto >> 3) & 0x0f : 0x07),
            _timelock(timelock)
        ) returns (
            uint256 id
        ) {
            _proposedAdmin(ti, actor, id, expected);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("proposeAdmin", expected, false, err);
        }
        _sweep();
    }

    function proposeProposalTtl(uint256 actorSeed, uint256 tiSeed, uint64 ttl) external observed {
        uint256 ti = tiSeed % 2;
        address actor = _actorFor(ti, actorSeed);
        bytes4 expected = _expectProposeAdmin(ti, actor);
        vm.prank(actor);
        try governance.proposeProposalTtl(tiId[ti], _ttl(ttl)) returns (uint256 id) {
            _proposedAdmin(ti, actor, id, expected);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("proposeAdmin", expected, false, err);
        }
        _sweep();
    }

    function signAdmin(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _adminProposal(proposalSeed);
        if (id == 0) return;
        bytes4 expected = _expectSignAdmin(id, actorSeed);
        address actor = _actorFor(_tiOf(governance.getAdminProposal(id).tiId), actorSeed);
        vm.prank(actor);
        try governance.signAdminProposal(id) {
            successes["signAdmin"]++;
            _outcome("signAdmin", expected, true, "");
            _applyIfExecuted(id);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("signAdmin", expected, false, err);
        }
        _sweep();
    }

    function executeAdmin(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _approvedAdminProposal(proposalSeed);
        if (id == 0) return;
        IGovernanceTypes.AdminProposalView memory p = governance.getAdminProposal(id);
        uint256 ti = _tiOf(p.tiId);
        address actor = _actorFor(ti, actorSeed);
        IGovernanceTypes.Policy memory policy = governance.getPolicy(p.tiId, IGovernanceTypes.PolicyKind.ADMIN);
        bytes4 expected = _expectExecute(ti, actor, p.state, p.signatures, p.quorumReachedAt, policy, true);
        vm.prank(actor);
        try governance.executeAdminProposal(id) {
            successes["executeAdmin"]++;
            _outcome("executeAdmin", expected, true, "");
            _checkDecided(ti, p.state, p.signatures, p.quorumReachedAt, policy);
            _applyIfExecuted(id);
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("executeAdmin", expected, false, err);
        }
        _sweep();
    }

    function cancelAdmin(uint256 actorSeed, uint256 proposalSeed) external observed {
        uint256 id = _adminProposal(proposalSeed);
        if (id == 0) return;
        IGovernanceTypes.AdminProposalView memory p = governance.getAdminProposal(id);
        uint256 ti = _tiOf(p.tiId);
        address actor = _actorFor(ti, actorSeed);
        RoleSet veto = governance.getPolicy(p.tiId, IGovernanceTypes.PolicyKind.ADMIN).vetoRoleMask;
        IGovernanceTypes.AdminAction action = p.change.action;
        bool ownRemoval =
            (action == IGovernanceTypes.AdminAction.REMOVE_SIGNER
                    || action == IGovernanceTypes.AdminAction.REPLACE_SIGNER) && p.change.subject == actor;
        bytes4 expected = _expectCancel(ti, actor, p.state, p.proposer, veto, ownRemoval);
        vm.prank(actor);
        try governance.cancelAdminProposal(id) {
            successes["cancelAdmin"]++;
            adminClosed[id] = true;
            _outcome("cancelAdmin", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("cancelAdmin", expected, false, err);
        }
        _sweep();
    }

    function expireAdmin(uint256 proposalSeed) external observed {
        uint256 id = _adminProposal(proposalSeed);
        if (id == 0) return;
        bytes4 expected = _expectExpire(adminClosed[id], governance.adminStateOf(id));
        try governance.expireAdminProposal(id) {
            successes["expireAdmin"]++;
            adminClosed[id] = true;
            _outcome("expireAdmin", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("expireAdmin", expected, false, err);
        }
        _sweep();
    }

    // -------------------------------------------------------------------------
    // Cosigners, set by the TAO
    // -------------------------------------------------------------------------

    /// Any of the cosigner DIDs, each with a role from 1 to 4; now and then
    /// a role of 0, the same DID twice or the TI's own DID, all refused.
    function setCosigners(uint256 tiSeed, uint8 pick, uint8 roleSeed0, uint8 roleSeed1) external observed {
        uint256 ti = tiSeed % 2;
        uint8[2] memory roles = [_cosignerRole(roleSeed0), _cosignerRole(roleSeed1)];
        IGovernanceTypes.Cosigner[] memory list = new IGovernanceTypes.Cosigner[](4);
        uint256 n;
        for (uint256 d = 0; d < 2; d++) {
            if (pick & (1 << d) != 0) list[n++] = IGovernanceTypes.Cosigner(cosignerDid[d], Role.wrap(roles[d]));
        }
        if ((pick >> 2) % 8 == 7) list[n++] = IGovernanceTypes.Cosigner(tiDid[ti], Role.wrap(1));
        if ((pick >> 5) % 8 == 7 && pick & 1 != 0) {
            list[n++] = IGovernanceTypes.Cosigner(cosignerDid[0], Role.wrap(roles[0]));
        }
        assembly ("memory-safe") {
            mstore(list, n)
        }
        bytes4 expected = _expectCosigners(ti, list, pick, roles);
        vm.prank(tao);
        try governance.setCosigners(tiId[ti], list) {
            successes["setCosigners"]++;
            for (uint256 d = 0; d < 2; d++) {
                ghostCosignerRole[ti][d] = pick & (1 << d) != 0 ? roles[d] : 0;
            }
            _outcome("setCosigners", expected, true, "");
        } catch (bytes memory err) {
            _dropLogs(); // a reverted call's events never happened
            _outcome("setCosigners", expected, false, err);
        }
        _sweep();
    }

    /// A cosigner's key is revoked in its DID document (one time in four),
    /// or restored to it.
    function toggleCosignerKey(uint256 seed) external observed {
        uint256 d = seed % cosignerDid.length;
        cosignerKeyRevoked[d] = (seed >> 1) % 4 == 3;
        dids.setController(bytes(cosignerDid[d]), cosignerOwner[d], !cosignerKeyRevoked[d]);
        _sweep();
    }

    // -------------------------------------------------------------------------
    // The world around the contract
    // -------------------------------------------------------------------------

    /// A key is revoked in its DID document (one time in four), or restored
    /// to it: mostly restored, so that the TIs keep working.
    function toggleKey(uint256 actorSeed, uint256 tiSeed) external observed {
        address actor = _actor(actorSeed);
        uint256 ti = tiSeed % 2;
        keyRevoked[ti][actor] = (tiSeed >> 1) % 4 == 3;
        dids.setController(bytes(tiDid[ti]), actor, !keyRevoked[ti][actor]);
        _sweep();
    }

    /// The TAO revokes one of the TI's two attributes (one time in four),
    /// or accredits it; the TI is active while the one it is under shows it.
    function toggleTi(uint256 tiSeed) external observed {
        uint256 ti = tiSeed % 2;
        uint256 k = (tiSeed >> 3) % 2;
        bool active = (tiSeed >> 1) % 4 != 3;
        attributeActive[ti][k] = active;
        issuers.accredit(
            tiDid[ti],
            attributes[k],
            active ? IEbsiIssuersRegistry.IssuerType.TI : IEbsiIssuersRegistry.IssuerType.Revoked,
            taoDid,
            taoAttribute
        );
        _sweep();
    }

    /// The TAO moves a TI to another of its attributes, which it may do
    /// exactly when that attribute shows the TI.
    function moveTi(uint256 tiSeed, uint256 attributeSeed) external observed {
        uint256 ti = tiSeed % 2;
        uint256 k = attributeSeed % 3;
        vm.prank(tao);
        try governance.setTiAttribute(tiId[ti], attributes[k]) {
            successes["moveTi"]++;
            if (!attributeActive[ti][k]) _violate("a TI was moved to an attribute that does not show it");
            currentAttribute[ti] = k;
        } catch {
            _dropLogs();
            if (attributeActive[ti][k]) _violate("a TI was not moved to an attribute that shows it");
        }
        _sweep();
    }

    /// A new implementation of either contract, with the same code: an
    /// upgrade in the middle of open proposals keeps everything they need.
    function upgrade(uint256 seed) external observed {
        uint256 proposals = governance.proposalCount();
        uint256 ruleChanges = governance.adminProposalCount();
        address owner = governance.owner();
        uint64[2] memory versions = [governance.getTi(tiId[0]).version, governance.getTi(tiId[1]).version];
        if (seed % 2 == 0) {
            governanceBeacon.upgradeTo(address(new CertificateGovernance(address(dids), address(issuers))));
        } else {
            registryBeacon.upgradeTo(address(new CertificateRegistry()));
        }
        successes["upgrade"]++;
        if (
            governance.proposalCount() != proposals || governance.adminProposalCount() != ruleChanges
                || governance.owner() != owner || governance.getTi(tiId[0]).version != versions[0]
                || governance.getTi(tiId[1]).version != versions[1]
        ) _violate("an upgrade changed the state");
        _sweep();
    }

    /// Mostly hours, sometimes past a timelock or a proposal's lifetime.
    function wait(uint256 seconds_) external observed {
        skip(seconds_ % 8 == 7 ? bound(seconds_ >> 3, 1 days, 40 days) : bound(seconds_ >> 3, 1 minutes, 12 hours));
        _sweep();
    }

    // -------------------------------------------------------------------------
    // For the invariants
    // -------------------------------------------------------------------------

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function certificateCount() external view returns (uint256) {
        return certificates.length;
    }

    function violationCount() external view returns (uint256) {
        return violations.length;
    }

    function violation(uint256 i) external view returns (string memory) {
        return violations[i];
    }

    function issuerOfCertificate(uint256 i) external view returns (uint8) {
        return issuerOf[i];
    }

    function cosignerCount() external view returns (uint256) {
        return cosignerDid.length;
    }

    function cosigner(uint256 i) external view returns (string memory did, address owner) {
        return (cosignerDid[i], cosignerOwner[i]);
    }

    /// The role the model says `actor` signs with: its stored role while its
    /// key is valid, or else the role of a cosigner DID it controls.
    function expectedRole(uint256 ti, address actor) external view returns (uint8) {
        return _role(ti, actor);
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    /// A key to add or swap in as a TI's signer: any but a cosigner DID's own.
    /// The contract takes one, but a key of both DIDs signs with its signer
    /// role only while the cosigner's role still counts as present, so the TI
    /// could lose its quorum; keeping the two apart is the operators' rule
    /// (contracts/README.md, "A cosigner's keys must not be the TI's own keys").
    function _newSigner(uint256 seed) private view returns (address) {
        address[] memory candidates = new address[](actors.length);
        uint256 n;
        for (uint256 i = 0; i < actors.length; i++) {
            bool cosigns;
            for (uint256 d = 0; d < cosignerOwner.length; d++) {
                if (cosignerOwner[d] == actors[i]) cosigns = true;
            }
            if (!cosigns) candidates[n++] = actors[i];
        }
        return candidates[seed % n];
    }

    function _proposal(uint256 seed) private view returns (uint256) {
        return _pick(false, seed, false);
    }

    function _approvedProposal(uint256 seed) private view returns (uint256) {
        return _pick(false, seed, true);
    }

    function _adminProposal(uint256 seed) private view returns (uint256) {
        return _pick(true, seed, false);
    }

    function _approvedAdminProposal(uint256 seed) private view returns (uint256) {
        return _pick(true, seed, true);
    }

    /// Mostly an open proposal among the latest sixteen (an approved one, if
    /// asked), where there is something left to do; now and then any.
    function _pick(bool admin, uint256 seed, bool approved) private view returns (uint256) {
        uint256 count = admin ? governance.adminProposalCount() : governance.proposalCount();
        if (count == 0) return 0;
        if (seed % 8 == 7) return 1 + (seed >> 3) % count;
        uint256 last = count > 16 ? count - 16 : 0;
        uint256[16] memory candidates;
        uint256 n;
        for (uint256 id = count; id > last; id--) {
            IGovernanceTypes.ProposalState state = admin ? governance.adminStateOf(id) : governance.stateOf(id);
            if (
                state == IGovernanceTypes.ProposalState.APPROVED
                    || (!approved && state == IGovernanceTypes.ProposalState.PROPOSED)
            ) candidates[n++] = id;
        }
        return n == 0 ? 1 + (seed >> 3) % count : candidates[(seed >> 3) % n];
    }

    /// Mostly a key the model says signs for the TI; now and then any key.
    function _actorFor(uint256 ti, uint256 seed) private view returns (address) {
        if (seed % 8 == 7) return _actor(seed >> 3);
        uint256 n;
        for (uint256 i = 0; i < actors.length; i++) {
            if (_role(ti, actors[i]) != 0) n++;
        }
        if (n == 0) return _actor(seed >> 3);
        uint256 pick = (seed >> 3) % n;
        for (uint256 i = 0; i < actors.length; i++) {
            if (_role(ti, actors[i]) != 0) {
                if (pick == 0) return actors[i];
                pick--;
            }
        }
        return actors[0]; // not reached
    }

    function _tiOf(bytes32 id) private view returns (uint256) {
        return id == tiId[0] ? 0 : 1;
    }

    function _tiActive(uint256 ti) private view returns (bool) {
        return attributeActive[ti][currentAttribute[ti]];
    }

    function _role(uint256 ti, address actor) private view returns (uint8) {
        uint8 role = ghostRole[ti][actor];
        if (role != 0) return keyRevoked[ti][actor] ? 0 : role;
        for (uint256 d = 0; d < cosignerDid.length; d++) {
            if (cosignerOwner[d] == actor && !cosignerKeyRevoked[d] && ghostCosignerRole[ti][d] != 0) {
                return ghostCosignerRole[ti][d];
            }
        }
        return 0;
    }

    /// Mostly short; one time in four up to past the pilot's 30-day
    /// lifetime, where a timelock and a lifetime can meet.
    function _timelock(uint64 seed) private pure returns (uint64) {
        return uint64(seed % 4 == 3 ? bound(seed >> 2, 0, 45 days) : bound(seed >> 2, 0, 3 days));
    }

    /// Half the time within a few days, near the timelocks; else anything
    /// up to two months.
    function _ttl(uint64 seed) private pure returns (uint64) {
        return uint64(seed % 2 == 0 ? bound(seed >> 1, 0, 5 days) : bound(seed >> 1, 0, 60 days));
    }

    function _cosignerRole(uint8 seed) private pure returns (uint8) {
        return seed % 8 == 7 ? 0 : 1 + seed % 4;
    }

    /// Every policy can be met and vetoed with the roles the model says hold
    /// a key or a cosigner, valid or not, as the contract counts them.
    function _allReachableWith(uint256 ti, uint8[2] memory cosignerRoles) private view returns (bool) {
        uint8 present;
        for (uint256 i = 0; i < actors.length; i++) {
            uint8 role = ghostRole[ti][actors[i]];
            if (role != 0) present |= uint8(1) << (role - 1);
        }
        for (uint256 d = 0; d < cosignerRoles.length; d++) {
            uint8 role = cosignerRoles[d];
            if (role != 0) present |= uint8(1) << (role - 1);
        }
        for (uint8 kind = 0; kind < 4; kind++) {
            IGovernanceTypes.Policy memory p = governance.getPolicy(tiId[ti], IGovernanceTypes.PolicyKind(kind));
            uint8 required = RoleSet.unwrap(p.requiredRoleMask);
            if (
                _count(present) < p.threshold || present & required != required
                    || present & RoleSet.unwrap(p.vetoRoleMask) == 0
            ) return false;
        }
        return true;
    }

    function _violate(string memory what) private {
        violations.push(what);
    }

    function _proposedAdmin(uint256 ti, address actor, uint256 id, bytes4 expected) private {
        successes["proposeAdmin"]++;
        if (_role(ti, actor) == 0) _violate("a key without a role proposed a rule change");
        if (!_tiActive(ti)) _violate("a revoked TI proposed a rule change");
        _outcome("proposeAdmin", expected, true, "");
        _applyIfExecuted(id);
    }

    // Expected outcomes ---------------------------------------------------------

    /// The call did what the model expected, or the violation says what it
    /// did instead (selectors: `cast 4byte`).
    function _outcome(string memory what, bytes4 expected, bool ok, bytes memory err) private {
        bytes4 got = ok ? OK : err.length >= 4 ? bytes4(err) : bytes4(0xffffffff);
        if (got == expected) return;
        if (expected == VALID_OR_INVALIDATED && (ok || _invalidates(got))) return;
        _violate(
            string.concat(
                what,
                ": expected ",
                vm.toString(abi.encodePacked(expected)),
                ", got ",
                vm.toString(abi.encodePacked(got))
            )
        );
    }

    /// The errors of a rule change no longer valid against the configuration.
    function _invalidates(bytes4 error) private pure returns (bool) {
        return error == IGovernanceTypes.InvalidSigner.selector || error == IGovernanceTypes.DuplicateSigner.selector
            || error == IGovernanceTypes.SignerRetired.selector || error == IGovernanceTypes.InvalidRole.selector
            || error == IGovernanceTypes.NotDidController.selector || error == IGovernanceTypes.InvalidPolicy.selector
            || error == IGovernanceTypes.InvalidTtl.selector || error == IGovernanceTypes.Unsatisfiable.selector;
    }

    /// In the order the contract checks: an active signer, a reason, the
    /// TI's own certificate not revoked, no proposal for it still open.
    function _expectPropose(
        uint256 ti,
        uint256 c,
        IGovernanceTypes.ActionType actionType,
        bytes32 reason,
        address actor
    ) private view returns (bytes4) {
        if (_role(ti, actor) == 0) return IGovernanceTypes.NotASigner.selector;
        if (!_tiActive(ti)) return IGovernanceTypes.TiNotActive.selector;
        if (reason == bytes32(0) && actionType != IGovernanceTypes.ActionType.REINSTATE) {
            return IGovernanceTypes.ReasonRequired.selector;
        }
        if (issuerOf[c] != ti) return IGovernanceTypes.NotCertificateIssuer.selector;
        if (ghostStanding[certificates[c]] == IGovernanceTypes.Standing.REVOKED) {
            return IGovernanceTypes.CertificateRevoked.selector;
        }
        uint256 existing = governance.openProposalFor(certificates[c]);
        if (existing != 0 && _isOpen(governance.stateOf(existing))) {
            return IGovernanceTypes.ProposalAlreadyOpen.selector;
        }
        return OK;
    }

    /// In the order the registry checks: a complete record, a period, a
    /// standing, an active signer of the TI, a key not yet on record.
    function _expectRegister(
        uint256 ti,
        address actor,
        bytes32 key,
        bool endsBeforeItBegins,
        IGovernanceTypes.Standing standing,
        bytes32 credential
    ) private view returns (bytes4) {
        if (credential == bytes32(0)) return IGovernanceTypes.IncompleteCertificate.selector;
        if (endsBeforeItBegins) return IGovernanceTypes.InvalidValidity.selector;
        if (standing == IGovernanceTypes.Standing.NONE) return IGovernanceTypes.InvalidStanding.selector;
        if (_role(ti, actor) == 0) return IGovernanceTypes.NotASigner.selector;
        if (!_tiActive(ti)) return IGovernanceTypes.TiNotActive.selector;
        if (registered[key]) return IGovernanceTypes.CertificateAlreadyRegistered.selector;
        return OK;
    }

    /// A status proposal checks the TI before the quorum; a rule change
    /// after it, and then the change itself.
    function _expectExecute(
        uint256 ti,
        address actor,
        IGovernanceTypes.ProposalState state,
        address[] memory signatures,
        uint64 quorumReachedAt,
        IGovernanceTypes.Policy memory policy,
        bool admin
    ) private view returns (bytes4) {
        if (!_isOpen(state)) return IGovernanceTypes.ProposalNotOpen.selector;
        if (_role(ti, actor) == 0) return IGovernanceTypes.NotASigner.selector;
        if (!admin && !_tiActive(ti)) return IGovernanceTypes.TiNotActive.selector;
        if (state != IGovernanceTypes.ProposalState.APPROVED) return IGovernanceTypes.QuorumNotReached.selector;
        if (!_meets(policy, _signedRoles(ti, signatures))) return IGovernanceTypes.QuorumNotReached.selector;
        if (block.timestamp < uint256(quorumReachedAt) + policy.timelock) {
            return IGovernanceTypes.TimelockNotElapsed.selector;
        }
        if (admin) return _tiActive(ti) ? VALID_OR_INVALIDATED : IGovernanceTypes.TiNotActive.selector;
        return OK;
    }

    function _expectCancel(
        uint256 ti,
        address actor,
        IGovernanceTypes.ProposalState state,
        address proposer,
        RoleSet veto,
        bool ownRemoval
    ) private view returns (bytes4) {
        if (!_isOpen(state)) return IGovernanceTypes.ProposalNotOpen.selector;
        uint8 role = _role(ti, actor);
        if (role == 0) return IGovernanceTypes.NotASigner.selector;
        if (ownRemoval) return IGovernanceTypes.CannotVetoOwnRemoval.selector;
        if (actor != proposer && !RoleSet.unwrap(veto)._has(role)) return IGovernanceTypes.VetoNotAllowed.selector;
        return OK;
    }

    function _expectExpire(bool isClosed, IGovernanceTypes.ProposalState state) private pure returns (bytes4) {
        if (isClosed) return IGovernanceTypes.ProposalNotOpen.selector;
        return state == IGovernanceTypes.ProposalState.EXPIRED ? OK : IGovernanceTypes.ProposalNotExpirable.selector;
    }

    function _expectProposeAdmin(uint256 ti, address actor) private view returns (bytes4) {
        if (_role(ti, actor) == 0) return IGovernanceTypes.NotASigner.selector;
        if (!_tiActive(ti)) return IGovernanceTypes.TiNotActive.selector;
        return VALID_OR_INVALIDATED;
    }

    /// A signature that completes the quorum of a rule change without a
    /// timelock applies it there and then.
    function _expectSignAdmin(uint256 id, uint256 actorSeed) private view returns (bytes4) {
        IGovernanceTypes.AdminProposalView memory p = governance.getAdminProposal(id);
        uint256 ti = _tiOf(p.tiId);
        address actor = _actorFor(ti, actorSeed);
        if (!_isOpen(p.state)) return IGovernanceTypes.ProposalNotOpen.selector;
        uint8 role = _role(ti, actor);
        if (role == 0) return IGovernanceTypes.NotASigner.selector;
        if (governance.hasSignedAdmin(id, actor)) return IGovernanceTypes.AlreadySigned.selector;
        IGovernanceTypes.Policy memory policy = governance.getPolicy(p.tiId, IGovernanceTypes.PolicyKind.ADMIN);
        uint8 before = _signedRoles(ti, p.signatures);
        uint8 signed = before | uint8(1) << (role - 1);
        bool reached =
            _meets(policy, signed) && (p.state == IGovernanceTypes.ProposalState.PROPOSED || !_meets(policy, before));
        if (!reached || policy.timelock != 0) return OK;
        return _tiActive(ti) ? VALID_OR_INVALIDATED : IGovernanceTypes.TiNotActive.selector;
    }

    /// Entry by entry: a DID neither empty, the TI's own nor repeated, a
    /// role in range; then every policy reachable with the new roles.
    function _expectCosigners(uint256 ti, IGovernanceTypes.Cosigner[] memory list, uint8 pick, uint8[2] memory roles)
        private
        view
        returns (bytes4)
    {
        for (uint256 i = 0; i < list.length; i++) {
            bytes32 did = keccak256(bytes(list[i].did));
            if (bytes(list[i].did).length == 0 || did == keccak256(bytes(tiDid[ti]))) {
                return IGovernanceTypes.InvalidCosigner.selector;
            }
            for (uint256 j = 0; j < i; j++) {
                if (keccak256(bytes(list[j].did)) == did) return IGovernanceTypes.InvalidCosigner.selector;
            }
            uint8 role = Role.unwrap(list[i].role);
            if (role == 0 || role > 8) return IGovernanceTypes.InvalidRole.selector;
        }
        uint8[2] memory next;
        for (uint256 d = 0; d < 2; d++) {
            next[d] = pick & (1 << d) != 0 ? roles[d] : 0;
        }
        return _allReachableWith(ti, next) ? OK : IGovernanceTypes.Unsatisfiable.selector;
    }

    function _isOpen(IGovernanceTypes.ProposalState state) private pure returns (bool) {
        return state == IGovernanceTypes.ProposalState.PROPOSED || state == IGovernanceTypes.ProposalState.APPROVED;
    }

    /// The roles the model says the signatures hold today.
    function _signedRoles(uint256 ti, address[] memory signatures) private view returns (uint8 signed) {
        for (uint256 i = 0; i < signatures.length; i++) {
            uint8 role = _role(ti, signatures[i]);
            if (role != 0) signed |= uint8(1) << (role - 1);
        }
    }

    function _meets(IGovernanceTypes.Policy memory policy, uint8 signed) private pure returns (bool) {
        uint8 required = RoleSet.unwrap(policy.requiredRoleMask);
        return _count(signed) >= policy.threshold && signed & required == required;
    }

    /// What a successful execution needs: the quorum, by the model's roles
    /// of its signatures today, the timelock behind it, and an active TI.
    function _checkDecided(
        uint256 ti,
        IGovernanceTypes.ProposalState state,
        address[] memory signatures,
        uint64 quorumReachedAt,
        IGovernanceTypes.Policy memory policy
    ) private {
        if (state != IGovernanceTypes.ProposalState.APPROVED) {
            _violate("executed what was not approved");
        }
        if (!_meets(policy, _signedRoles(ti, signatures))) _violate("executed without a quorum");
        if (block.timestamp < uint256(quorumReachedAt) + policy.timelock) _violate("executed inside the timelock");
        if (!_tiActive(ti)) _violate("a revoked TI executed");
    }

    /// A rule change the contract carried out, carried out in the model.
    function _applyIfExecuted(uint256 id) private {
        if (applied[id] || governance.adminStateOf(id) != IGovernanceTypes.ProposalState.EXECUTED) return;
        applied[id] = true;
        adminClosed[id] = true;
        IGovernanceTypes.AdminProposalView memory p = governance.getAdminProposal(id);
        uint256 ti = _tiOf(p.tiId);
        IGovernanceTypes.AdminChange memory change = p.change;
        if (change.action == IGovernanceTypes.AdminAction.ADD_SIGNER) {
            if (ghostRetired[ti][change.subject]) _violate("a retired key came back");
            ghostRole[ti][change.subject] = Role.unwrap(change.role);
        } else if (change.action == IGovernanceTypes.AdminAction.REMOVE_SIGNER) {
            ghostRole[ti][change.subject] = 0;
            ghostRetired[ti][change.subject] = true;
        } else if (change.action == IGovernanceTypes.AdminAction.REPLACE_SIGNER) {
            if (ghostRetired[ti][change.replacement]) _violate("a retired key came back");
            ghostRole[ti][change.replacement] = ghostRole[ti][change.subject];
            ghostRole[ti][change.subject] = 0;
            ghostRetired[ti][change.subject] = true;
        }
    }

    /// A proposal that has finished stays as it finished.
    function _sweep() private {
        uint256 count = governance.proposalCount();
        for (uint256 id = 1; id <= count; id++) {
            _settle(finished, id, governance.stateOf(id), "a finished proposal changed");
        }
        count = governance.adminProposalCount();
        for (uint256 id = 1; id <= count; id++) {
            _settle(adminFinished, id, governance.adminStateOf(id), "a finished rule change changed");
        }
    }

    function _settle(
        mapping(uint256 => IGovernanceTypes.ProposalState) storage seen,
        uint256 id,
        IGovernanceTypes.ProposalState state,
        string memory what
    ) private {
        IGovernanceTypes.ProposalState recorded = seen[id];
        if (recorded != IGovernanceTypes.ProposalState.NONE) {
            if (state != recorded) {
                _violate(string.concat(what, ": ", vm.toString(id)));
                seen[id] = state; // once, not on every sweep after
            }
        } else if (
            state == IGovernanceTypes.ProposalState.EXECUTED || state == IGovernanceTypes.ProposalState.CANCELLED
                || state == IGovernanceTypes.ProposalState.EXPIRED
        ) {
            seen[id] = state;
        }
    }

    function _count(uint8 bits) private pure returns (uint8 n) {
        for (; bits != 0; bits &= bits - 1) {
            n++;
        }
    }
}

function _has(uint8 set, uint8 role) pure returns (bool) {
    return role != 0 && role <= 8 && set & (uint8(1) << (role - 1)) != 0;
}
