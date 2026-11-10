import { Contract, Transaction, getAddress, type Provider, type Signer, type Result } from 'ethers';
import {
  GOVERNANCE_ABI,
  ADMIN_ACTIONS,
  PROPOSAL_STATES,
} from '../../shared/governance-contract.ts';
import {
  policyKinds,
  governanceRoles,
  type AdminChange,
  type GovernanceConfiguration,
  type GovernancePolicy,
} from './admin-policy.ts';
import { tiIdOf } from './ti-governance.ts';

/** A rule change as read from the contract, with its TI and the rules it would change. */
export interface AdminProposalView {
  issuerDid: string;
  change: AdminChange;
  state: string;
  rolesSigned: string[];
  configuration: GovernanceConfiguration;
}
/** Confirmed console governance transaction and the proposal it created, if any. */
export interface GovernanceTransaction {
  transactionHash: string;
  id?: string;
}
/** Per-TI governance reads and the TIs' body-key writes the console may request. */
export interface ConsoleLedger {
  contract: string;
  registry: string;
  chainId: number;
  addresses(issuerDid: string): Promise<Record<string, string>>;
  configuration(issuerDid: string): Promise<GovernanceConfiguration>;
  adminProposal(id: string): Promise<AdminProposalView>;
  proposalIssuer(id: string): Promise<string>;
  confirmedTransaction(
    hash: string,
  ): Promise<{ confirmed: boolean; failed?: boolean; createdId?: string }>;
  rebroadcast(raw: string, hash: string): Promise<void>;
  transact(
    issuerDid: string,
    role: string,
    functionName: string,
    args: readonly unknown[],
  ): Promise<GovernanceTransaction>;
}

/**
 * List the role letters in a contract bitmask.
 * @param mask - Contract role bitmask.
 * @returns Present role letters.
 */
export function rolesIn(mask: bigint | number) {
  return governanceRoles.filter((_, index) => Boolean(Number(mask) & (1 << index)));
}

/**
 * Encode role letters as the contract's role bitmask.
 * @param roles - Role letters.
 * @returns Combined bitmask.
 */
export function roleMask(roles: string[]) {
  return roles.reduce((mask, role) => mask | (1 << governanceRoles.indexOf(role)), 0);
}

/**
 * Translate a contract policy tuple to its console representation.
 * @param value - Contract policy tuple.
 * @returns The policy with role letters.
 */
function policy(value: Result): GovernancePolicy {
  return {
    threshold: Number(value.threshold),
    requiredRoles: rolesIn(value.requiredRoleMask),
    vetoRoles: rolesIn(value.vetoRoleMask),
    timelock: Number(value.timelock),
  };
}

/**
 * The contract call that proposes a rule change for one TI.
 * @param change - Validated rule change.
 * @param issuerDid - The TI whose rules change.
 * @returns Function name and arguments, the TI's id first.
 */
export function adminCall(
  change: AdminChange,
  issuerDid: string,
): { functionName: string; args: unknown[] } {
  const tiId = tiIdOf(issuerDid);
  switch (change.action) {
    case 'add_signer':
      return {
        functionName: 'proposeAddSigner',
        args: [tiId, change.subject, governanceRoles.indexOf(change.role) + 1],
      };
    case 'remove_signer':
      return { functionName: 'proposeRemoveSigner', args: [tiId, change.subject] };
    case 'replace_signer':
      return {
        functionName: 'proposeReplaceSigner',
        args: [tiId, change.subject, change.replacement],
      };
    case 'set_policy':
      return {
        functionName: 'proposePolicy',
        args: [
          tiId,
          policyKinds.indexOf(change.kind),
          change.threshold,
          roleMask(change.required_roles),
          roleMask(change.veto_roles),
          change.timelock,
        ],
      };
    case 'set_proposal_ttl':
      return { functionName: 'proposeProposalTtl', args: [tiId, change.ttl] };
  }
}

/**
 * Create console governance reads and exact body-role writes on one deployment.
 * @param options - Chain, governance and registry addresses, read provider, the TIs' role
 * signers and confirmation depth.
 * @returns The console ledger adapter.
 * @throws Error for an invalid deployment.
 * @remarks Each TI has its own rules and its own A and B keys on the one governance contract.
 */
export function consoleLedger(options: {
  chainId: number;
  address: string;
  registry: string;
  provider: Provider;
  signersFor(issuerDid: string, role: 'A' | 'B'): Promise<Signer>;
  confirmations?: number;
}): ConsoleLedger {
  const { chainId, provider, signersFor, confirmations = 1 } = options;
  const contract = getAddress(options.address);
  const registry = getAddress(options.registry);
  if (!Number.isSafeInteger(chainId) || chainId < 1 || confirmations < 1)
    throw new Error('Configure a pinned governance deployment.');
  const reader = new Contract(contract, GOVERNANCE_ABI, provider);

  /**
   * Read one TI's rules in one call.
   * @param issuerDid - The TI.
   * @returns Signers with roles, policies, roles present, TTL and version.
   * @throws RPC errors; UnknownTi for a TI not set up.
   */
  async function configuration(issuerDid: string): Promise<GovernanceConfiguration> {
    const value = await reader.getTi(tiIdOf(issuerDid));
    return {
      signers: [...value.signers].map((address: string, index: number) => ({
        address,
        role: governanceRoles[Number(value.roles[index]) - 1],
      })),
      cosignerRoles: [...value.cosigners].map(
        (cosigner: { role: bigint }) => governanceRoles[Number(cosigner.role) - 1],
      ),
      policies: Object.fromEntries(
        policyKinds.map((kind, index) => [kind, policy(value.policies[index])]),
      ) as GovernanceConfiguration['policies'],
      rolesPresent: rolesIn(value.rolesPresentMask),
      proposalTtl: Number(value.proposalTtl),
      version: Number(value.version),
    };
  }

  /**
   * The DID of the TI a contract id names.
   * @param tiId - Contract TI id.
   * @returns Its DID.
   * @throws RPC errors; UnknownTi.
   */
  async function didOf(tiId: string) {
    return String((await reader.getTi(tiId)).did);
  }

  return {
    contract,
    registry,
    chainId,
    configuration,
    /**
     * The TI a status proposal belongs to.
     * @param id - On-chain proposal id.
     * @returns The TI's DID.
     */
    async proposalIssuer(id) {
      return didOf((await reader.getProposal(id)).tiId);
    },
    /**
     * Send a retained signed transaction again, if the node no longer has it.
     * @param raw - Signed transaction.
     * @param hash - Its hash.
     * @returns Completion once the node holds it.
     */
    async rebroadcast(raw, hash) {
      const signed = Transaction.from(raw);
      if (
        signed.hash !== hash ||
        signed.chainId !== BigInt(chainId) ||
        ![contract, registry].includes(String(signed.to)) ||
        signed.type !== 2 ||
        signed.value !== 0n
      )
        throw new Error('The retained transaction belongs to another deployment.');
      if (await provider.getTransaction(hash)) return;
      try {
        await provider.broadcastTransaction(raw);
      } catch (error) {
        if (!(await provider.getTransaction(hash))) throw error;
      }
    },
    /**
     * A transaction's confirmation, and the proposal it created, if any.
     * @param hash - Transaction hash.
     * @returns Whether it is confirmed, failed, and the created proposal id.
     */
    async confirmedTransaction(hash) {
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt || (await provider.getBlockNumber()) < receipt.blockNumber + confirmations - 1)
        return { confirmed: false };
      if (receipt.status !== 1) return { confirmed: true, failed: true };
      let createdId: string | undefined;
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== contract) continue;
        const event = reader.interface.parseLog(log);
        if (event?.name === 'AdminProposalCreated')
          createdId = event.args.adminProposalId.toString();
        if (event?.name === 'ProposalCreated') createdId = event.args.proposalId.toString();
      }
      return { confirmed: true, createdId };
    },
    /**
     * The addresses of a TI's A and B keys held here.
     * @param issuerDid - The TI.
     * @returns Addresses by role.
     */
    async addresses(issuerDid) {
      return Object.fromEntries(
        await Promise.all(
          (['A', 'B'] as const).map(async (role) => [
            role,
            await (await signersFor(issuerDid, role)).getAddress(),
          ]),
        ),
      );
    },
    /**
     * A rule change as the back-office checks it, with its TI and that TI's rules now.
     * @param id - Rule-change id.
     * @returns The TI, the change, its state, the roles that signed and the configuration.
     */
    async adminProposal(id) {
      const value = await reader.getAdminProposal(id);
      const issuerDid = await didOf(value.tiId);
      const config = await configuration(issuerDid);
      const raw = value.change;
      const action = ADMIN_ACTIONS[Number(raw.action)];
      let change: AdminChange;
      if (action === 'add_signer')
        change = { action, subject: raw.subject, role: governanceRoles[Number(raw.role) - 1] };
      else if (action === 'remove_signer') change = { action, subject: raw.subject };
      else if (action === 'replace_signer')
        change = { action, subject: raw.subject, replacement: raw.replacement };
      else if (action === 'set_policy') {
        const p = policy(raw.policy);
        change = {
          action,
          kind: policyKinds[Number(raw.kind)],
          threshold: p.threshold,
          required_roles: p.requiredRoles,
          veto_roles: p.vetoRoles,
          timelock: p.timelock,
        };
      } else change = { action: 'set_proposal_ttl', ttl: Number(raw.ttl) };
      return {
        issuerDid,
        change,
        state: PROPOSAL_STATES[Number(value.state)],
        rolesSigned: rolesIn(value.rolesSignedMask),
        configuration: config,
      };
    },
    /**
     * Sign and send a governance call with one of a TI's role keys, once it is that role's.
     * @param issuerDid - The TI.
     * @param role - A or B.
     * @param functionName - Contract function.
     * @param args - Its arguments.
     * @returns The transaction hash and any created proposal id.
     */
    async transact(issuerDid, role, functionName, args) {
      if (!['A', 'B'].includes(role)) throw new Error('The role key is not held here.');
      const signer = await signersFor(issuerDid, role as 'A' | 'B');
      if ((await provider.getNetwork()).chainId !== BigInt(chainId))
        throw new Error('Governance chain mismatch.');
      if (
        (await reader.roleOf(tiIdOf(issuerDid), await signer.getAddress())) !==
        BigInt(governanceRoles.indexOf(role) + 1)
      )
        throw new Error('The key no longer holds the requested contract role.');
      const writer = new Contract(contract, GOVERNANCE_ABI, signer);
      const method = writer.getFunction(functionName);
      await method.staticCall(...args);
      const transaction = await method(...args);
      const receipt = await transaction.wait(confirmations, 30000);
      if (!receipt || receipt.status !== 1)
        throw new Error('Governance transaction is unconfirmed.');
      let id: string | undefined;
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== contract) continue;
        const event = writer.interface.parseLog(log);
        if (event?.name === 'AdminProposalCreated') id = event.args.adminProposalId.toString();
        if (event?.name === 'ProposalCreated') id = event.args.proposalId.toString();
      }
      return { transactionHash: transaction.hash, id };
    },
  };
}
