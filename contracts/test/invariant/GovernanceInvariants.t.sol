pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console} from "forge-std/console.sol";
import {IGovernanceTypes, POLICY_KINDS} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {GovernanceTest} from "../GovernanceTest.sol";
import {IEbsiIssuersRegistry} from "../../contracts/interfaces/IEbsiRegistries.sol";
import {StubDidRegistry} from "../RegistryStubs.sol";
import {EventMirror} from "./EventMirror.sol";
import {GovernanceHandler} from "./GovernanceHandler.sol";

/**
 * The properties of component 10 that no sequence of calls may break, on
 * one contract with two TIs: the pilot's TI (A, B and C) and another (X and
 * Y), with D, E and F as keys a rule change may add, S and U as the keys of
 * two DIDs the TAO may make cosigners, and one key that is never anyone's.
 * The handler owns both beacons, and upgrades either contract.
 * Profile `deep` runs them longer (foundry.toml).
 */
contract GovernanceInvariantTest is StdInvariant, GovernanceTest {
    string private constant OTHER_TI_DID = "did:ebsi:zOtherTi";

    GovernanceHandler private handler;

    function setUp() public override {
        vm.recordLogs(); // the set-up's events seed the mirror
        super.setUp();
        address X = makeAddr("X");
        address Y = makeAddr("Y");
        accreditTi(OTHER_TI_DID);
        vm.prank(tao);
        governance.addTi(setup(OTHER_TI_DID, keys(X, Y), roles(ROLE_A, ROLE_B), pilotPolicies(), pilotTtl));

        handler = new GovernanceHandler(
            governance,
            registry,
            didRegistry,
            issuersRegistry,
            [TI_DID, OTHER_TI_DID],
            taoDid,
            TAO_ATTRIBUTE,
            TI_ATTRIBUTE
        );
        address S = makeAddr("S");
        address U = makeAddr("U");
        address[12] memory actors = [A, B, C, makeAddr("D"), makeAddr("E"), makeAddr("F"), X, Y, S, U, outsider, spare];
        for (uint256 i = 0; i < actors.length; i++) {
            handler.addActor(actors[i]);
        }
        handler.setTao(tao);
        beacon.transferOwnership(address(handler));
        registryBeacon.transferOwnership(address(handler));
        handler.setBeacons(beacon, registryBeacon);
        handler.addCosignerDid("did:ebsi:zSupervisor", S);
        handler.addCosignerDid("did:ebsi:zAuditor", U);
        handler.seedSigner(0, A, 1);
        handler.seedSigner(0, B, 2);
        handler.seedSigner(0, C, 3);
        handler.seedSigner(1, X, 1);
        handler.seedSigner(1, Y, 2);

        handler.addCertificate(CERTIFICATE, 0);
        handler.addCertificate(OTHER_CERTIFICATE, 0);
        _register(A, TI_DID, "urn:uuid:third", 0);
        _register(X, OTHER_TI_DID, "urn:uuid:fixture", 1); // the same id, another TI
        _register(Y, OTHER_TI_DID, "urn:uuid:other-of-other", 1);

        bytes4[] memory selectors = new bytes4[](23);
        selectors[0] = GovernanceHandler.propose.selector;
        selectors[1] = GovernanceHandler.sign.selector;
        selectors[2] = GovernanceHandler.execute.selector;
        selectors[3] = GovernanceHandler.cancel.selector;
        selectors[4] = GovernanceHandler.expire.selector;
        selectors[5] = GovernanceHandler.suspendNow.selector;
        selectors[6] = GovernanceHandler.proposeAddSigner.selector;
        selectors[7] = GovernanceHandler.proposeRemoveSigner.selector;
        selectors[8] = GovernanceHandler.proposeReplaceSigner.selector;
        selectors[9] = GovernanceHandler.proposePolicy.selector;
        selectors[10] = GovernanceHandler.proposeProposalTtl.selector;
        selectors[11] = GovernanceHandler.signAdmin.selector;
        selectors[12] = GovernanceHandler.executeAdmin.selector;
        selectors[13] = GovernanceHandler.cancelAdmin.selector;
        selectors[14] = GovernanceHandler.expireAdmin.selector;
        selectors[15] = GovernanceHandler.toggleKey.selector;
        selectors[16] = GovernanceHandler.wait.selector;
        selectors[17] = GovernanceHandler.toggleTi.selector;
        selectors[18] = GovernanceHandler.setCosigners.selector;
        selectors[19] = GovernanceHandler.toggleCosignerKey.selector;
        selectors[20] = GovernanceHandler.moveTi.selector;
        selectors[21] = GovernanceHandler.upgrade.selector;
        selectors[22] = GovernanceHandler.registerCertificate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));

        EventMirror mirror = new EventMirror(address(governance), address(registry));
        mirror.consume(vm.getRecordedLogs());
        handler.setMirror(mirror);
    }

    function _register(address by, string memory did, string memory id, uint8 ti) private {
        bytes32 idHash = Hashes.certificateIdHash(id);
        vm.prank(by);
        bytes32 key = registry.registerCertificate(idHash, did, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
        handler.addCertificate(key, ti);
    }

    // -----------------------------------------------------------------------
    // Invariants
    // -----------------------------------------------------------------------

    /// No successful call broke a rule the handler checks: only a key with a
    /// role acts, only a veto role (or the proposer) cancels, an execution
    /// has its quorum and its timelock behind it, a revoked certificate is
    /// never proposed for, a finished proposal stays finished.
    function invariant_NoCallBrokeARule() public view {
        uint256 broken = handler.violationCount();
        assertEq(broken, 0, broken == 0 ? "" : handler.violation(0));
    }

    /// Each certificate stands where the executed proposals and urgent
    /// suspensions put it, and nothing else; a revoked one stays revoked.
    function invariant_EveryStandingIsTheDecidedOne() public view {
        for (uint256 i = 0; i < handler.certificateCount(); i++) {
            bytes32 key = handler.certificates(i);
            assertEq(uint8(registry.certificateStatus(key).standing), uint8(handler.ghostStanding(key)), "standing");
        }
    }

    /// Each key signs with the role the executed rule changes gave it, while
    /// the DID Registry shows it, or a cosigner's role for a DID it controls;
    /// a retired key is never a signer of the TI again.
    function invariant_EveryKeyHasTheDecidedRole() public view {
        for (uint256 ti = 0; ti < 2; ti++) {
            bytes32 id = handler.tiId(ti);
            for (uint256 i = 0; i < handler.actorCount(); i++) {
                address actor = handler.actors(i);
                assertEq(Role.unwrap(governance.roleOf(id, actor)), handler.expectedRole(ti, actor), "role");
                assertEq(governance.retired(id, actor), handler.ghostRetired(ti, actor), "retired");
                if (governance.retired(id, actor)) assertFalse(_isOwnSigner(id, actor), "retired signs");
            }
        }
    }

    /// At most one proposal per certificate is open, and it is the one the
    /// contract points to.
    function invariant_OneOpenProposalPerCertificate() public view {
        uint256 count = governance.proposalCount();
        for (uint256 i = 0; i < handler.certificateCount(); i++) {
            bytes32 key = handler.certificates(i);
            uint256 open;
            uint256 openId;
            for (uint256 id = 1; id <= count; id++) {
                if (governance.getProposal(id).statusKey != key) continue;
                IGovernanceTypes.ProposalState state = governance.stateOf(id);
                if (
                    state == IGovernanceTypes.ProposalState.PROPOSED || state == IGovernanceTypes.ProposalState.APPROVED
                ) {
                    open++;
                    openId = id;
                }
            }
            assertLe(open, 1, "open proposals of one certificate");
            if (open == 1) assertEq(governance.openProposalFor(key), openId, "the open one");
        }
    }

    /// Whatever the rule changes did, every policy can still be met and
    /// vetoed with the roles that hold a key, within the limits, and its
    /// proposals live long enough to be signed and executed.
    function invariant_EveryPolicyStaysReachable() public view {
        for (uint256 ti = 0; ti < 2; ti++) {
            IGovernanceTypes.TiView memory view_ = governance.getTi(handler.tiId(ti));
            uint8 present = RoleSet.unwrap(view_.rolesPresentMask);
            assertLe(view_.proposalTtl, governance.MAX_PROPOSAL_TTL(), "ttl");
            for (uint8 kind = 0; kind < POLICY_KINDS; kind++) {
                IGovernanceTypes.Policy memory p = view_.policies[kind];
                uint8 required = RoleSet.unwrap(p.requiredRoleMask);
                assertLe(p.timelock, governance.MAX_TIMELOCK(), "timelock");
                assertGe(view_.proposalTtl, p.timelock + governance.MIN_SIGNING_WINDOW(), "time left to execute");
                assertGt(p.threshold, 0, "threshold");
                assertLe(_count(required), p.threshold, "required roles");
                assertGe(_count(present), p.threshold, "enough roles");
                assertEq(present & required, required, "required roles present");
                assertTrue(present & RoleSet.unwrap(p.vetoRoleMask) != 0, "a veto role present");
            }
        }
    }

    /// What the events tell a reader is what the contracts hold: each
    /// certificate's standing; each TI's signers, roles, policies, lifetime
    /// and attribute; each proposal's state (expired once past the lifetime
    /// it opened with), signatures, quorum and executable time.
    function invariant_TheEventsTellTheState() public view {
        EventMirror mirror = handler.mirror();
        for (uint256 i = 0; i < handler.certificateCount(); i++) {
            bytes32 key = handler.certificates(i);
            assertEq(uint8(mirror.standing(key)), uint8(registry.certificateStatus(key).standing), "event: standing");
        }
        for (uint256 ti = 0; ti < 2; ti++) {
            _tiMatches(mirror, handler.tiId(ti));
        }
        assertEq(mirror.proposalCount(), governance.proposalCount(), "event: proposals");
        for (uint256 id = 1; id <= governance.proposalCount(); id++) {
            IGovernanceTypes.ProposalView memory p = governance.getProposal(id);
            EventMirror.Ballot memory b = mirror.proposal(id);
            assertEq(b.tiId, p.tiId, "event: proposal's TI");
            assertEq(b.statusKey, p.statusKey, "event: proposal's certificate");
            _ballotMatches(mirror, b, p.state, p.signatures, p.quorumReachedAt, p.executableAt);
        }
        assertEq(mirror.adminProposalCount(), governance.adminProposalCount(), "event: rule changes");
        for (uint256 id = 1; id <= governance.adminProposalCount(); id++) {
            IGovernanceTypes.AdminProposalView memory p = governance.getAdminProposal(id);
            EventMirror.Ballot memory b = mirror.adminProposal(id);
            assertEq(b.tiId, p.tiId, "event: rule change's TI");
            _ballotMatches(mirror, b, p.state, p.signatures, p.quorumReachedAt, p.executableAt);
        }
    }

    /// Liveness: whatever the calls did, once a TI's keys are valid again
    /// and its accreditation is back, its signers can still decide. A rule
    /// change and a status change each go through to execution, with any
    /// open proposal for the certificate withdrawn or vetoed first. Tried
    /// on a snapshot, and undone.
    function invariant_TheSignersCanStillDecide() public {
        uint256 snapshot = vm.snapshotState();
        for (uint256 ti = 0; ti < 2; ti++) {
            _restore(ti);
            address[] memory signers = _signers(handler.tiId(ti));
            assertGt(signers.length, 0, "a TI without signers");
            _aRuleChangePasses(handler.tiId(ti), signers);
            _aStatusChangePasses(ti, signers);
        }
        vm.revertToState(snapshot);
    }

    /// What the run got through, with `-vv`: a run of reverts proves nothing.
    function afterInvariant() public view {
        string[15] memory names = [
            "propose",
            "sign",
            "execute",
            "cancel",
            "expire",
            "suspendNow",
            "proposeAdmin",
            "signAdmin",
            "executeAdmin",
            "cancelAdmin",
            "expireAdmin",
            "setCosigners",
            "moveTi",
            "upgrade",
            "registerCertificate"
        ];
        console.log("proposals", governance.proposalCount(), "rule changes", governance.adminProposalCount());
        for (uint256 i = 0; i < names.length; i++) {
            console.log(names[i], handler.successes(names[i]));
        }
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    function _tiMatches(EventMirror mirror, bytes32 id) private view {
        IGovernanceTypes.TiView memory v = governance.getTi(id);
        assertEq(mirror.attribute(id), v.attributeId, "event: attribute");
        assertEq(mirror.ttl(id), v.proposalTtl, "event: lifetime");
        assertEq(mirror.signerCount(id), v.signers.length, "event: signers");
        for (uint256 i = 0; i < v.signers.length; i++) {
            assertEq(Role.unwrap(mirror.role(id, v.signers[i])), Role.unwrap(v.roles[i]), "event: role");
        }
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address actor = handler.actors(i);
            assertEq(mirror.retired(id, actor), governance.retired(id, actor), "event: retired");
        }
        for (uint256 kind = 0; kind < POLICY_KINDS; kind++) {
            IGovernanceTypes.Policy memory p = mirror.policy(id, kind);
            assertEq(p.threshold, v.policies[kind].threshold, "event: threshold");
            assertEq(
                RoleSet.unwrap(p.requiredRoleMask), RoleSet.unwrap(v.policies[kind].requiredRoleMask), "event: required"
            );
            assertEq(RoleSet.unwrap(p.vetoRoleMask), RoleSet.unwrap(v.policies[kind].vetoRoleMask), "event: veto");
            assertEq(p.timelock, v.policies[kind].timelock, "event: timelock");
        }
    }

    /// The executable time a reader works out: the last quorum's time and
    /// the policy's timelock as the events last set it.
    function _ballotMatches(
        EventMirror mirror,
        EventMirror.Ballot memory b,
        IGovernanceTypes.ProposalState state,
        address[] memory signatures,
        uint64 quorumReachedAt,
        uint64 executableAt
    ) private view {
        assertEq(uint8(mirror.stateNow(b)), uint8(state), "event: state");
        assertEq(b.signatures, signatures, "event: signatures");
        assertEq(b.quorumReachedAt, quorumReachedAt, "event: quorum reached");
        uint64 expected = b.quorumReachedAt == 0 ? 0 : b.quorumReachedAt + mirror.policy(b.tiId, uint8(b.kind)).timelock;
        assertEq(expected, executableAt, "event: executable at");
    }

    // -----------------------------------------------------------------------
    // Liveness
    // -----------------------------------------------------------------------

    /// Every key valid in the TI's DID and in the cosigners' DIDs, and the
    /// TI accredited under its attribute.
    function _restore(uint256 ti) private {
        string memory did = ti == 0 ? TI_DID : OTHER_TI_DID;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            StubDidRegistry(didRegistry).setController(bytes(did), handler.actors(i), true);
        }
        for (uint256 i = 0; i < handler.cosignerCount(); i++) {
            (string memory cosignerDid, address owner) = handler.cosigner(i);
            StubDidRegistry(didRegistry).setController(bytes(cosignerDid), owner, true);
        }
        bytes32 attribute = governance.getTi(handler.tiId(ti)).attributeId;
        issuers.accredit(did, attribute, IEbsiIssuersRegistry.IssuerType.TI, taoDid, TAO_ATTRIBUTE);
    }

    function _signers(bytes32 id) private view returns (address[] memory signers) {
        signers = new address[](handler.actorCount());
        uint256 n;
        for (uint256 i = 0; i < signers.length; i++) {
            if (governance.isSigner(id, handler.actors(i))) signers[n++] = handler.actors(i);
        }
        assembly ("memory-safe") {
            mstore(signers, n)
        }
    }

    /// The lifetime set again to what it is: valid whatever else changed.
    function _aRuleChangePasses(bytes32 id, address[] memory signers) private {
        uint64 ttl = governance.getTi(id).proposalTtl; // ahead: a call would take the prank
        vm.prank(signers[0]);
        uint256 change = governance.proposeProposalTtl(id, ttl);
        for (uint256 i = 1; i < signers.length; i++) {
            if (governance.adminStateOf(change) != IGovernanceTypes.ProposalState.PROPOSED) break;
            vm.prank(signers[i]);
            governance.signAdminProposal(change);
        }
        if (governance.adminStateOf(change) == IGovernanceTypes.ProposalState.APPROVED) {
            vm.warp(governance.getAdminProposal(change).executableAt);
            vm.prank(signers[0]);
            governance.executeAdminProposal(change);
        }
        assertEq(
            uint8(governance.adminStateOf(change)),
            uint8(IGovernanceTypes.ProposalState.EXECUTED),
            "the signers cannot pass a rule change"
        );
    }

    /// A certificate of the TI not revoked goes through every status
    /// action, each under its own policy: reinstated if suspended, then
    /// suspended, reinstated, and revoked.
    function _aStatusChangePasses(uint256 ti, address[] memory signers) private {
        bytes32 key;
        for (uint256 i = 0; i < handler.certificateCount() && key == bytes32(0); i++) {
            bytes32 candidate = handler.certificates(i);
            if (
                handler.issuerOfCertificate(i) == ti
                    && registry.certificateStatus(candidate).standing != IGovernanceTypes.Standing.REVOKED
            ) key = candidate;
        }
        if (key == bytes32(0)) return;
        _closeOpenProposal(key, signers);
        bytes32 tiId = handler.tiId(ti);
        if (registry.certificateStatus(key).standing == IGovernanceTypes.Standing.SUSPENDED) {
            _decide(tiId, key, IGovernanceTypes.ActionType.REINSTATE, signers);
        }
        _decide(tiId, key, IGovernanceTypes.ActionType.SUSPEND, signers);
        _decide(tiId, key, IGovernanceTypes.ActionType.REINSTATE, signers);
        _decide(tiId, key, IGovernanceTypes.ActionType.REVOKE, signers);
    }

    /// Proposed, signed by every signer until the quorum, executed once
    /// the timelock is over, and applied.
    function _decide(bytes32 tiId, bytes32 key, IGovernanceTypes.ActionType action, address[] memory signers) private {
        vm.prank(signers[0]);
        uint256 id = governance.proposeAction(tiId, key, action, REASON_GIVEN);
        for (uint256 i = 1; i < signers.length; i++) {
            if (governance.stateOf(id) != IGovernanceTypes.ProposalState.PROPOSED) break;
            vm.prank(signers[i]);
            governance.signProposal(id);
        }
        assertEq(
            uint8(governance.stateOf(id)),
            uint8(IGovernanceTypes.ProposalState.APPROVED),
            "the signers cannot reach a quorum"
        );
        vm.warp(governance.getProposal(id).executableAt);
        vm.prank(signers[0]);
        governance.execute(id);
        IGovernanceTypes.Standing expected = action == IGovernanceTypes.ActionType.REVOKE
            ? IGovernanceTypes.Standing.REVOKED
            : action == IGovernanceTypes.ActionType.SUSPEND
                ? IGovernanceTypes.Standing.SUSPENDED
                : IGovernanceTypes.Standing.VALID;
        assertEq(uint8(registry.certificateStatus(key).standing), uint8(expected), "the status change did not apply");
    }

    /// Its proposer withdraws it, or a key with the veto stops it.
    function _closeOpenProposal(bytes32 key, address[] memory signers) private {
        uint256 open = governance.openProposalFor(key);
        if (open == 0) return;
        IGovernanceTypes.ProposalState state = governance.stateOf(open);
        if (state != IGovernanceTypes.ProposalState.PROPOSED && state != IGovernanceTypes.ProposalState.APPROVED) {
            return; // past its lifetime: the next proposal expires it
        }
        for (uint256 i = 0; i < signers.length; i++) {
            vm.prank(signers[i]);
            try governance.cancelProposal(open, REASON) {
                return;
            } catch {}
        }
        fail("no signer can stop an open proposal");
    }

    /// Among the TI's own keys, as opposed to a cosigner's.
    function _isOwnSigner(bytes32 id, address actor) private view returns (bool) {
        address[] memory signers = governance.getTi(id).signers;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == actor) return true;
        }
        return false;
    }

    function _count(uint8 bits) private pure returns (uint8 n) {
        for (; bits != 0; bits &= bits - 1) {
            n++;
        }
    }
}
