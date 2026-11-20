pragma solidity 0.8.26;

import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {RuleChanges} from "../contracts/governance/RuleChanges.sol";
import {StatusProposals} from "../contracts/governance/StatusProposals.sol";
import {TiAccreditation} from "../contracts/governance/TiAccreditation.sol";
import {TiConfiguration} from "../contracts/governance/TiConfiguration.sol";

/**
 * Each module's ERC-7201 namespace as an ordinary state variable, so that the
 * compiler reports the layout of every field in it: `forge inspect` leaves
 * namespaced storage out. Never deployed. scripts/storage-layout.js compares
 * the reported layout with test/storage-layout.json, so that an upgrade can
 * only add fields where adding moves nothing.
 */
contract StorageLayouts {
    TiAccreditation.AccreditationStorage internal tiAccreditation;
    TiConfiguration.TiConfigurationStorage internal tiConfiguration;
    StatusProposals.StatusProposalsStorage internal statusProposals;
    RuleChanges.RuleChangesStorage internal ruleChanges;
    CertificateRegistry.CertificateRegistryStorage internal certificateRegistry;
}
