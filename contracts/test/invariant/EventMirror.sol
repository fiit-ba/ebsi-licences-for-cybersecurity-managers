pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {ICertificateRegistry} from "../../contracts/interfaces/ICertificateRegistry.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {IRuleChanges} from "../../contracts/interfaces/IRuleChanges.sol";
import {IStatusProposals} from "../../contracts/interfaces/IStatusProposals.sol";
import {ITiConfiguration} from "../../contracts/interfaces/ITiConfiguration.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";

/**
 * What the back-office can know from the contracts' events alone, as its
 * indexer catches up: each certificate's standing, each TI's signers,
 * policies, lifetime and attribute, and each proposal's state, signatures
 * and dates. invariant_TheEventsTellTheState compares it with the contracts.
 *
 * Cosigners are not here: `CosignersChanged` names the TI and nothing else,
 * so a reader asks `getTi` for them.
 */
contract EventMirror {
    struct Ballot {
        bytes32 tiId;
        bytes32 statusKey; // a status proposal's certificate
        IGovernanceTypes.PolicyKind kind;
        IGovernanceTypes.ProposalState state;
        uint64 quorumReachedAt;
        uint64 expiresAt; // its opening and the lifetime the events last set
        address[] signatures;
    }

    address private immutable governance;
    address private immutable registry;

    mapping(bytes32 => IGovernanceTypes.Standing) public standing;
    mapping(bytes32 => mapping(address => Role)) public role;
    mapping(bytes32 => mapping(address => bool)) public retired;
    mapping(bytes32 => uint256) public signerCount;
    mapping(bytes32 => mapping(uint256 => IGovernanceTypes.Policy)) private policies;
    mapping(bytes32 => uint64) public ttl;
    mapping(bytes32 => bytes32) public attribute;

    uint256 public proposalCount;
    uint256 public adminProposalCount;
    mapping(uint256 => Ballot) private proposals;
    mapping(uint256 => Ballot) private adminProposals;

    constructor(address governance_, address registry_) {
        governance = governance_;
        registry = registry_;
    }

    /// Every log of one call, in order, at the time it was made.
    function consume(Vm.Log[] memory logs) external {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == governance) _governance(logs[i]);
            else if (logs[i].emitter == registry) _registry(logs[i]);
        }
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    function policy(bytes32 tiId, uint256 kind) external view returns (IGovernanceTypes.Policy memory) {
        return policies[tiId][kind];
    }

    function proposal(uint256 id) external view returns (Ballot memory) {
        return proposals[id];
    }

    function adminProposal(uint256 id) external view returns (Ballot memory) {
        return adminProposals[id];
    }

    /// The state a reader works out: an open ballot past the lifetime it
    /// opened with is expired, marked or not.
    function stateNow(Ballot memory ballot) public view returns (IGovernanceTypes.ProposalState) {
        bool open = ballot.state == IGovernanceTypes.ProposalState.PROPOSED
            || ballot.state == IGovernanceTypes.ProposalState.APPROVED;
        return open && block.timestamp >= ballot.expiresAt ? IGovernanceTypes.ProposalState.EXPIRED : ballot.state;
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    function _registry(Vm.Log memory log) private {
        bytes32 topic = log.topics[0];
        if (topic == ICertificateRegistry.CertificateRegistered.selector) {
            (,,, IGovernanceTypes.Standing s) =
                abi.decode(log.data, (bytes32, uint64, uint64, IGovernanceTypes.Standing));
            standing[log.topics[1]] = s;
        } else if (topic == ICertificateRegistry.CertificateStandingChanged.selector) {
            (IGovernanceTypes.Standing s,) = abi.decode(log.data, (IGovernanceTypes.Standing, bytes32));
            standing[log.topics[1]] = s;
        }
    }

    function _governance(Vm.Log memory log) private {
        bytes32 topic = log.topics[0];
        if (_configuration(log, topic)) return;
        if (topic == IStatusProposals.ProposalCreated.selector) {
            (bytes32 tiId, IGovernanceTypes.ActionType action,) =
                abi.decode(log.data, (bytes32, IGovernanceTypes.ActionType, bytes32));
            uint256 id = uint256(log.topics[1]);
            proposalCount = id;
            Ballot storage b = proposals[id];
            b.statusKey = log.topics[2];
            b.kind = IGovernanceTypes.PolicyKind(uint8(action));
            _open(b, tiId);
        } else if (topic == IStatusProposals.ProposalSigned.selector) {
            proposals[uint256(log.topics[1])].signatures.push(address(uint160(uint256(log.topics[2]))));
        } else if (topic == IStatusProposals.QuorumReached.selector) {
            _approved(proposals[uint256(log.topics[1])]);
        } else if (topic == IStatusProposals.ProposalExecuted.selector) {
            proposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.EXECUTED;
        } else if (topic == IStatusProposals.ProposalCancelled.selector) {
            proposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.CANCELLED;
        } else if (topic == IStatusProposals.ProposalExpired.selector) {
            proposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.EXPIRED;
        } else if (topic == IRuleChanges.AdminProposalCreated.selector) {
            uint256 id = uint256(log.topics[1]);
            adminProposalCount = id;
            Ballot storage b = adminProposals[id];
            b.kind = IGovernanceTypes.PolicyKind.ADMIN;
            _open(b, log.topics[2]);
        } else if (topic == IRuleChanges.AdminProposalSigned.selector) {
            adminProposals[uint256(log.topics[1])].signatures.push(address(uint160(uint256(log.topics[2]))));
        } else if (topic == IRuleChanges.AdminQuorumReached.selector) {
            _approved(adminProposals[uint256(log.topics[1])]);
        } else if (topic == IRuleChanges.AdminProposalExecuted.selector) {
            adminProposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.EXECUTED;
        } else if (topic == IRuleChanges.AdminProposalCancelled.selector) {
            adminProposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.CANCELLED;
        } else if (topic == IRuleChanges.AdminProposalExpired.selector) {
            adminProposals[uint256(log.topics[1])].state = IGovernanceTypes.ProposalState.EXPIRED;
        }
    }

    /// A TI's configuration; whether the log was one.
    function _configuration(Vm.Log memory log, bytes32 topic) private returns (bool) {
        bytes32 tiId = log.topics.length > 1 ? log.topics[1] : bytes32(0);
        if (topic == ITiConfiguration.TiConfigured.selector) {
            (, bytes32 attributeId) = abi.decode(log.data, (string, bytes32));
            attribute[tiId] = attributeId;
        } else if (topic == ITiConfiguration.TiAttributeChanged.selector) {
            attribute[tiId] = abi.decode(log.data, (bytes32));
        } else if (topic == ITiConfiguration.SignerAdded.selector) {
            role[tiId][address(uint160(uint256(log.topics[2])))] = abi.decode(log.data, (Role));
            signerCount[tiId]++;
        } else if (topic == ITiConfiguration.SignerRemoved.selector) {
            _retire(tiId, address(uint160(uint256(log.topics[2]))));
            signerCount[tiId]--;
        } else if (topic == ITiConfiguration.SignerReplaced.selector) {
            _retire(tiId, address(uint160(uint256(log.topics[2]))));
            role[tiId][address(uint160(uint256(log.topics[3])))] = abi.decode(log.data, (Role));
        } else if (topic == ITiConfiguration.PolicyChanged.selector) {
            (uint8 threshold, RoleSet required, RoleSet veto, uint64 timelock) =
                abi.decode(log.data, (uint8, RoleSet, RoleSet, uint64));
            policies[tiId][uint256(log.topics[2])] = IGovernanceTypes.Policy(threshold, required, veto, timelock);
        } else if (topic == ITiConfiguration.ProposalTtlChanged.selector) {
            ttl[tiId] = abi.decode(log.data, (uint64));
        } else {
            return false;
        }
        return true;
    }

    function _open(Ballot storage b, bytes32 tiId) private {
        b.tiId = tiId;
        b.state = IGovernanceTypes.ProposalState.PROPOSED;
        b.expiresAt = uint64(block.timestamp) + ttl[tiId];
    }

    function _approved(Ballot storage b) private {
        b.state = IGovernanceTypes.ProposalState.APPROVED;
        b.quorumReachedAt = uint64(block.timestamp);
    }

    function _retire(bytes32 tiId, address signer) private {
        role[tiId][signer] = Role.wrap(0);
        retired[tiId][signer] = true;
    }
}
