// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {IRuleChanges} from "./IRuleChanges.sol";
import {IStatusProposals} from "./IStatusProposals.sol";
import {ITiConfiguration} from "./ITiConfiguration.sol";

/**
 * @title ICertificateGovernance
 * @notice The external interface of the Certificate Governance Contract
 *         (component 10): what the Gateway, the console, a signer's wallet or
 *         another contract may call, and what it emits. A verifier reads
 *         ICertificateRegistry instead.
 *
 * @dev The order of the bases follows the contract's own: reversing it leaves
 *      no linearization.
 */
interface ICertificateGovernance is IRuleChanges, IStatusProposals, ITiConfiguration {}
