import {
  Contract,
  getAddress,
  type Provider,
  type Signer,
  type ContractTransactionResponse,
  type Result,
} from 'ethers';
import { tiIdOf } from './ti-governance.ts';

/** Retryable ledger/Gateway failure, separate from local decision-integrity refusals. */
export class GovernanceUnavailable extends Error {
  /** Create a redacted provider failure for the task retry policy. */
  constructor() {
    super('Governance provider unavailable.');
  }
}

const actions = { suspend: 0n, revoke: 1n, reinstate: 2n };
// APPROVED replaced QUORUM_REACHED and TIMELOCKED: executableAt says when it can run.
const states = ['none', 'proposed', 'approved', 'executed', 'cancelled', 'expired'] as const;
const [, proposed, approved, executed, cancelled, expired] = states.map((_, index) =>
  BigInt(index),
);
/** Observed lifecycle state of a governance contract proposal. */
export type GovernanceState = (typeof states)[number];
/** Certificate/reason bindings for one approved governance decision. */
export interface GovernanceCase {
  action: keyof typeof actions;
  reasonHash: string;
  onchainId: string | null;
  /** The certificate's record key on the certificate registry. */
  statusKey: string;
  credentialId: string;
  issuerDid: string;
  /** SHA-256 of the collected credential's JWT, as its record holds it. */
  credentialHash: string;
  approved?: boolean;
  phase?: 'propose' | 'sign' | 'reconcile';
}

/** Confirmed contract proposal identifier and current lifecycle state. */
export interface GovernanceProgress {
  id: string;
  state: GovernanceState;
  executableAt?: number;
  approverSigned?: boolean;
}

/** Pinned governance deployment and operations for decision delivery or cancellation. */
export interface GovernanceActions {
  chainId: number;
  contract: string;
  advance(proposal: GovernanceCase): Promise<GovernanceProgress>;
  withdraw(proposal: GovernanceCase, reasonHash: string): Promise<GovernanceProgress>;
}

const governanceAbi = [
  'event ProposalCreated(uint256 indexed proposalId, bytes32 tiId, bytes32 indexed statusKey, uint8 actionType, bytes32 reasonHash, address indexed proposer)',
  'function isSigner(bytes32 tiId, address account) view returns (bool)',
  'function roleOf(bytes32 tiId, address account) view returns (uint8)',
  'function getProposal(uint256) view returns (tuple(bytes32 tiId,bytes32 statusKey,uint8 actionType,bytes32 reasonHash,uint64 proposedAt,uint64 quorumReachedAt,uint8 state,address[] signatures,uint64 executableAt,uint8 rolesSignedMask,address proposer))',
  'function openProposalFor(bytes32) view returns (uint256)',
  'function proposeAction(bytes32 tiId,bytes32 statusKey,uint8 actionType,bytes32 reasonHash) returns (uint256)',
  'function signProposal(uint256)',
  'function execute(uint256)',
  'function cancelProposal(uint256,bytes32)',
];
const registryAbi = [
  'function certificateStatus(bytes32) view returns (tuple(uint8 standing,uint64 validFrom,uint64 validUntil,uint64 registeredAt,uint64 changedAt,bytes32 credentialHash,string issuerDid))',
];

/**
 * Create governance delivery with exact proposal reconciliation after lost responses.
 *
 * @param options - Chain, governance and certificate registry addresses, read provider, the
 * issuing TI's A (proposer) and B (approver) signers, deployment block and confirmation depth.
 * @returns The deployment identity and advance/withdraw operations.
 * @throws Error for invalid chain, block or confirmation configuration.
 * @remarks Each TI decides its own certificates with its own keys (one contract for every TI of
 * a TAO), so the signers are resolved per case from the certificate's issuer.
 */
export function governanceActions(options: {
  chainId: number;
  address: string;
  registry: string;
  provider: Provider;
  signersFor(issuerDid: string): Promise<{ proposer: Signer; approver: Signer }>;
  fromBlock: number;
  confirmations?: number;
}): GovernanceActions {
  const { chainId, provider, signersFor, fromBlock, confirmations = 1 } = options;

  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1
  ) {
    throw new Error('Configure the governance chain and deployment block.');
  }
  const contract = getAddress(options.address);
  const reader = new Contract(contract, governanceAbi, provider);
  const registry = new Contract(getAddress(options.registry), registryAbi, provider);

  /**
   * Compare a proposal tuple with its immutable approved bindings.
   *
   * @param view - Contract proposal tuple.
   * @param proposal - Expected action, TI, certificate key and reason hash.
   * @returns Whether all approved bindings match.
   */
  function matches(view: Result, proposal: GovernanceCase) {
    return (
      view.tiId.toLowerCase() === tiIdOf(proposal.issuerDid).toLowerCase() &&
      view.statusKey.toLowerCase() === proposal.statusKey.toLowerCase() &&
      view.reasonHash.toLowerCase() === proposal.reasonHash.toLowerCase() &&
      view.actionType === actions[proposal.action]
    );
  }

  /**
   * Read a proposal and require the immutable case bindings to match.
   *
   * @param id - Contract proposal ID.
   * @param proposal - Expected bindings.
   * @param blockTag - Block at which to read.
   * @returns The matching contract proposal tuple.
   * @throws Error for a binding mismatch; RPC errors.
   */
  async function exact(id: string, proposal: GovernanceCase, blockTag: number | string = 'latest') {
    const view = await reader.getProposal(id, { blockTag });
    if (!matches(view, proposal))
      throw new Error('The governance case does not match its on-chain proposal.');
    return view;
  }

  /**
   * Recover a matching proposal from its pinned ID or bounded event queries.
   *
   * @param proposal - Expected immutable governance case.
   * @param rejectOtherOpen - Whether another open proposal should cause refusal.
   * @returns The matching ID, or undefined when no matching creation is observed.
   * @throws Error for ambiguous matches or conflicting open proposals; RPC errors.
   */
  async function locate(proposal: GovernanceCase, rejectOtherOpen = true) {
    if (proposal.onchainId) {
      await exact(proposal.onchainId, proposal);
      return proposal.onchainId;
    }
    // openProposalFor is cleared on execution and veto. Search creation
    // events as well so a lost response cannot open a second decision.
    const head = await provider.getBlockNumber();
    const ids = new Set<string>();
    for (let start = fromBlock; start <= head; start += 2000) {
      const logs = await reader.queryFilter(
        reader.filters.ProposalCreated(null, null, proposal.statusKey),
        start,
        Math.min(head, start + 1999),
      );
      for (const log of logs) {
        const event = reader.interface.parseLog(log);
        if (
          event?.args.reasonHash.toLowerCase() === proposal.reasonHash.toLowerCase() &&
          event.args.actionType === actions[proposal.action] &&
          event.args.tiId.toLowerCase() === tiIdOf(proposal.issuerDid).toLowerCase()
        )
          ids.add(event.args.proposalId.toString());
      }
    }
    if (ids.size > 1) throw new Error('Multiple governance proposals share this immutable reason.');
    const id = [...ids][0];
    if (id) return id;
    const open = await reader.openProposalFor(proposal.statusKey);
    if (rejectOtherOpen && open !== 0n) {
      const pending = await reader.getProposal(open);
      if (pending.state !== cancelled && pending.state !== expired) {
        throw new Error('A different proposal is already open for this certificate.');
      }
    }
  }

  /**
   * Require the same proposal state at the stable block and current head.
   *
   * @param id - Contract proposal ID.
   * @param proposal - Expected immutable governance case.
   * @returns The confirmed ID and recognized state.
   * @throws Error while confirmation depth or stable state is insufficient, or bindings/state are
   * invalid; RPC errors.
   */
  async function confirmed(id: string, proposal: GovernanceCase): Promise<GovernanceProgress> {
    const head = await provider.getBlockNumber();
    const block = head - confirmations + 1;
    if (block < fromBlock) throw new Error('The governance proposal is awaiting confirmations.');
    const stable = await exact(id, proposal, block);
    const latest = await exact(id, proposal);
    if (stable.state !== latest.state)
      throw new Error('The governance decision is awaiting confirmations.');
    const state = states[Number(stable.state)];
    if (!state) throw new Error('Unrecognized governance state.');
    return {
      id,
      state,
      executableAt: Number(stable.executableAt),
      approverSigned: (stable.rolesSignedMask & 2n) !== 0n,
    };
  }

  /**
   * Wait for a successful governance transaction receipt.
   *
   * @param transaction - Submitted transaction response.
   * @returns Completion after the configured confirmations.
   * @throws Error for a missing/failed receipt; RPC or receipt-timeout errors.
   */
  async function mine(transaction: ContractTransactionResponse) {
    const receipt = await transaction.wait(confirmations, 30_000);
    if (!receipt || receipt.status !== 1)
      throw new Error('Governance transaction was not confirmed.');
  }

  return {
    chainId,
    contract,
    /**
     * Cancel the exact case without creating, signing or executing another decision.
     *
     * @param proposal - Expected immutable governance case.
     * @param reasonHash - Withdrawal reason commitment.
     * @returns The reconciled confirmed terminal or current state.
     * @throws Error for missing signer authority, unresolved submissions or conflicting bindings;
     * signer/RPC errors.
     */
    async withdraw(proposal, reasonHash) {
      const { proposer } = await signersFor(proposal.issuerDid);
      const network = await provider.getNetwork();
      const primaryAddress = await proposer.getAddress();
      if (
        network.chainId !== BigInt(chainId) ||
        !(await reader.isSigner(tiIdOf(proposal.issuerDid), primaryAddress))
      ) {
        throw new Error('Withdrawal requires the TI’s governance signer.');
      }
      // Do not create, sign or execute a decision while trying to stop it.
      // A pinned submission whose response was lost may still be in flight.
      // Keep it pending until its exact creation event can be reconciled.
      const id = await locate(proposal, false);
      if (!id) throw new Error('The original governance submission is awaiting reconciliation.');
      const view = await exact(id, proposal);
      if ([proposed, approved].includes(view.state)) {
        try {
          await mine(
            await new Contract(contract, governanceAbi, proposer).cancelProposal(id, reasonHash),
          );
        } catch (error) {
          const after = await exact(id, proposal);
          if (![executed, cancelled, expired].includes(after.state)) throw error;
        }
      }
      return confirmed(id, proposal);
    },
    /**
     * Propose, independently sign and execute a case as contract rules permit.
     *
     * @param proposal - Approved case with immutable certificate and reason bindings.
     * @returns The reconciled confirmed proposal state; a running timelock leaves it approved.
     * @throws Error for wrong chain/signers, a missing or mismatched record or insufficient
     * confirmations; signer/RPC errors.
     * @remarks A proposal names a recorded certificate: until the collected certificate's record
     * is confirmed on the certificate registry, the case waits.
     */
    async advance(proposal) {
      if ((await provider.getNetwork()).chainId !== BigInt(chainId))
        throw new Error('Governance chain does not match.');

      const certificate = await registry.certificateStatus(proposal.statusKey);
      if (certificate.standing === 0n)
        throw new Error('The certificate record is awaiting registration.');
      if (
        certificate.issuerDid !== proposal.issuerDid ||
        certificate.credentialHash.toLowerCase() !== proposal.credentialHash.toLowerCase()
      ) {
        throw new Error('The certificate record does not match the approved case.');
      }
      const { proposer, approver } = await signersFor(proposal.issuerDid);
      const primary = new Contract(contract, governanceAbi, proposer);
      const tiId = tiIdOf(proposal.issuerDid);
      let id = await locate(proposal);
      if (!id && proposal.phase && proposal.phase !== 'propose')
        throw new Error('The proposing transaction is awaiting reconciliation.');
      if (!id) {
        try {
          await mine(
            await primary.proposeAction(
              tiId,
              proposal.statusKey,
              actions[proposal.action],
              proposal.reasonHash,
            ),
          );
        } catch (error) {
          id = await locate(proposal);
          if (!id) throw error;
        }
        id ??= await locate(proposal);
      }
      if (!id) throw new Error('The submitted governance proposal is unavailable.');
      let view = await exact(id, proposal);
      if (
        (!proposal.phase || proposal.phase === 'sign') &&
        proposal.approved !== false &&
        view.state === proposed &&
        (view.rolesSignedMask & 2n) === 0n
      ) {
        try {
          const primaryAddress = await proposer.getAddress();
          const secondaryAddress = await approver.getAddress();
          if (
            primaryAddress === secondaryAddress ||
            (await reader.roleOf(tiId, secondaryAddress)) !== 2n
          )
            throw new Error('No distinct active B role key is available.');
          await mine(await new Contract(contract, governanceAbi, approver).signProposal(id));
        } catch (error) {
          view = await exact(id, proposal);
          if (view.state === proposed && (view.rolesSignedMask & 2n) === 0n) throw error;
        }
        view = await exact(id, proposal);
      }
      if (
        (!proposal.phase || proposal.phase === 'reconcile') &&
        proposal.approved !== false &&
        view.state === approved
      ) {
        const block = await provider.getBlock('latest');
        if (!block) throw new Error('The governance chain clock is unavailable.');
        if (view.executableAt <= BigInt(block.timestamp)) {
          try {
            await mine(await primary.execute(id));
          } catch (error) {
            view = await exact(id, proposal);
            if (view.state !== executed) throw error;
          }
        }
      }
      return confirmed(id, proposal);
    },
  };
}
