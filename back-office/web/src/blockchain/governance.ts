// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).
/**
 * The Revocation Governance Contract (component 10), as the console sees it.
 *
 * Reads go straight to the ledger so an operator can see the on-chain state
 * without trusting the back-office's copy of it — which is the point of
 * component 10.2's "independent check of the history": the supervisory
 * authority can confirm nothing executed without the roles its policy asks
 * for, without access to the certification body's systems.
 *
 * Votes take one of two paths, and the difference is who holds the key:
 *
 * - A signer's own wallet (castVote below). The key stays in the wallet — the
 *   page only ever sees an address and a transaction hash. This is how the
 *   supervisory authority votes: component 10.2 makes the external signer the
 *   whole value of the multisig, and that is lost the moment its signature is
 *   cast with a key the certification body's systems hold.
 * - A role key held by the back-office (governanceVote and governanceAdmin in
 *   shared/api/governance.ts), for the certification body's own roles (components 3, 3.4).
 *
 * The page itself never holds a private key on either path.
 */

import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroHash,
  getAddress,
  keccak256,
  toUtf8Bytes,
} from 'ethers';
// The contract's ABI and enums, generated from its source by
// contracts/scripts/export-abi.js (design decisions D19) - the same file the
// back-office and the back-office read theirs from, so none of them restates it.
import {
  ACTION_TYPES,
  ADMIN_ACTIONS,
  GOVERNANCE_ABI,
  POLICY_KINDS,
  PROPOSAL_STATES,
  REGISTRY_ABI,
  ROLES,
} from './certificateGovernanceContract.ts';
import { t } from '../shared/i18n/index.ts';

export { ACTION_TYPES, ADMIN_ACTIONS, POLICY_KINDS, ROLES };

// Roles and policies, read the same way as the backend governance adapters
// reads them: a role is its letter (component 10.2), a set of roles a bitmask
// with bit 0 for role 1. The contract names every such set `...Mask` so it is
// not taken for one role's number (design decisions D21); read into lists of
// letters, they lose the suffix.

const ROLE_LETTERS = Object.fromEntries(Object.entries(ROLES).map(([letter, n]) => [n, letter]));

/**
 * A role number as its letter, or the number if it has none.
 * @param role - Existing signer role identifier.
 * @returns The known role letter or numeric fallback.
 */
export const roleName = (role) => ROLE_LETTERS[Number(role)] ?? String(Number(role));

/**
 * The roles in a mask, by letter.
 * @param mask - Contract role bitmask.
 * @returns The role letters represented by the supplied mask.
 */
export function rolesIn(mask) {
  const roles = [];
  for (let role = 1; role <= 8; role++) {
    if (Number(mask) & (1 << (role - 1))) roles.push(roleName(role));
  }
  return roles;
}

/**
 * Role letters as a mask - the inverse of rolesIn.
 * @param letters - Role letters to combine into a contract mask.
 * @returns The combined role bitmask.
 */
export const roleMask = (letters) =>
  letters.reduce((mask, letter) => mask | (1 << (ROLES[letter] - 1)), 0);

const policyView = (policy) => ({
  threshold: Number(policy.threshold),
  requiredRoles: rolesIn(policy.requiredRoleMask),
  vetoRoles: rolesIn(policy.vetoRoleMask),
  timelock: Number(policy.timelock),
});

/** The console names states as the badges do: PROPOSED, TIMELOCKED, … */
const stateName = (n) => (PROPOSAL_STATES[Number(n)] ?? 'none').toUpperCase();

/**
 * The ledger endpoint, as an absolute URL.
 *
 * It stays same-origin — the dev proxy is still what reaches Besu — but ethers'
 * FetchRequest dispatches on the URL scheme, so a bare '/api-ledger' fails with
 * "unsupported protocol" before a request is ever made, and the console then
 * reports the ledger as unreachable when it is fine.
 * @returns The absolute configured RPC URL, resolving the existing proxy path against this origin.
 */
function rpcUrl() {
  const target = import.meta.env.VITE_LEDGER_RPC || '/api-ledger';
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  return new URL(target, window.location.origin).toString();
}

/**
 * Create a read-only ledger provider using the existing same-origin RPC configuration.
 * @returns A read-only ethers JSON-RPC provider.
 */
function provider() {
  return new JsonRpcProvider(rpcUrl(), undefined, { staticNetwork: true });
}

/**
 * Create the governance contract reader from its generated ABI and ledger provider.
 * @param address - Governance contract address on the configured ledger.
 * @returns An ethers governance contract connected to the read provider.
 */
function contract(address) {
  return new Contract(address, GOVERNANCE_ABI, provider());
}

/**
 * The id the governance contract keeps a TI under: keccak256 of its DID.
 * @param did - TI DID.
 * @returns The 0x-hex TI id.
 */
export const tiIdOf = (did) => keccak256(toUtf8Bytes(did));

const registries = new Map();
/**
 * The certificate registry the governance contract executes its decisions in.
 * @param address - Governance contract address on the configured ledger.
 * @returns An ethers registry contract connected to the read provider.
 */
async function registry(address) {
  if (!registries.has(address))
    registries.set(
      address,
      contract(address)
        .certificateRegistry()
        .catch((error) => {
          registries.delete(address);
          throw error;
        }),
    );
  return new Contract(await registries.get(address), REGISTRY_ABI, provider());
}

/**
 * Read the ledger chain ID and latest block number together.
 * @returns The ledger chainId and latest blockNumber.
 * @throws Contract, RPC or decoding errors; preimage verification also rejects malformed salts.
 */
export async function ledgerInfo() {
  const p = provider();
  const [network, blockNumber] = await Promise.all([p.getNetwork(), p.getBlockNumber()]);
  return { chainId: Number(network.chainId), blockNumber };
}

/**
 * Who signs as which role for one TI, what each kind of its decisions needs, in one read; and
 * the contract's proposal counts.
 * @param address - Governance contract address on the configured ledger.
 * @param tiDid - The TI whose rules to read; omitted, only the counts.
 * @returns The contract address, the TI and its signers, cosigners, policies, roles, proposal
 * lifetime, version, and the counts.
 * @throws Contract, RPC or decoding errors; UnknownTi for a TI not set up on the contract.
 */
export async function contractInfo(address, tiDid = '') {
  const c = contract(address);
  const [ti, count, adminCount] = await Promise.all([
    tiDid ? c.getTi(tiIdOf(tiDid)) : null,
    c.proposalCount(),
    c.adminProposalCount(),
  ]);
  return {
    address,
    ti: tiDid,
    tiId: tiDid ? tiIdOf(tiDid) : '',
    signers: ti
      ? [...ti.signers].map((signer, i) => ({ address: signer, role: roleName(ti.roles[i]) }))
      : [],
    cosigners: ti
      ? [...ti.cosigners].map((item) => ({ did: item.did, role: roleName(item.role) }))
      : [],
    policies: ti
      ? Object.fromEntries(POLICY_KINDS.map((kind, i) => [kind, policyView(ti.policies[i])]))
      : {},
    rolesPresent: ti ? rolesIn(ti.rolesPresentMask) : [],
    proposalTtl: ti ? Number(ti.proposalTtl) : 0,
    version: ti ? Number(ti.version) : 0,
    proposalCount: Number(count),
    adminProposalCount: Number(adminCount),
  };
}

/**
 * The role a key signs one TI's proposals with right now: as one of the TI's own keys, or as a
 * key of a cosigner's DID (the supervisory authority's, role C). Only the contract knows the
 * latter - it asks the DID registry - so the console asks it too.
 * @param address - Governance contract address on the configured ledger.
 * @param tiDid - The TI whose proposals the key would sign.
 * @param account - The key's address.
 * @returns The role letter, or '' for none.
 * @throws Contract, RPC or decoding errors.
 */
export async function signerRole(address, tiDid, account) {
  if (!tiDid || !account) return '';
  const role = Number(await contract(address).roleOf(tiIdOf(tiDid), account));
  return role ? roleName(role) : '';
}

/**
 * The newest ids first, down to `limit` of them.
 * @param count - Available ledger proposal count.
 * @param limit - Maximum number of newest records to read.
 * @returns The bounded descending proposal IDs.
 */
function latest(count, limit) {
  const ids = [];
  for (let id = count; id >= Math.max(1, count - limit + 1); id--) ids.push(id);
  return ids;
}

/** What a status proposal and a rule change have in common, read the same way. */
const ballot = (p) => ({
  proposedAt: Number(p.proposedAt),
  quorumReachedAt: Number(p.quorumReachedAt),
  state: stateName(p.state),
  signatures: [...p.signatures],
  rolesSigned: rolesIn(p.rolesSignedMask),
  proposer: p.proposer,
  executableAt: Number(p.executableAt),
});

/**
 * Read the newest status proposals independently from the configured ledger.
 * @param address - Governance contract address on the configured ledger.
 * @param limit - Maximum number of newest records to read.
 * @returns The latest status proposals with ballots, reason commitments and commitment occupancy.
 * @throws Contract, RPC or decoding errors; preimage verification also rejects malformed salts.
 */
export async function listProposals(address, limit = 25) {
  const c = contract(address);
  const count = Number(await c.proposalCount());
  return Promise.all(
    latest(count, limit).map(async (id) => {
      const p = await c.getProposal(id);
      const state = stateName(p.state);
      // The contract reports EXPIRED as soon as the TTL passes, but only
      // releases the certificate once someone calls expireProposal. Until then
      // it cannot be proposed again, which is worth knowing.
      const holdsKey = state === 'EXPIRED' && Number(await c.openProposalFor(p.statusKey)) === id;
      return {
        id,
        tiId: p.tiId,
        // The certificate's record on the certificate registry.
        statusKey: p.statusKey,
        // The reason's salted commitment (D22); zero for a reinstatement without one.
        reasonHash: p.reasonHash,
        action: ACTION_TYPES[Number(p.actionType)] ?? 'unknown',
        ...ballot(p),
        holdsKey,
      };
    }),
  );
}

/**
 * A rule change as the back-office takes it - the same shape as
 * plr.services.governance.change_from_view - so the console can ask the
 * back-office about it (registry/governance/admin/check).
 * @param raw - Raw contract rule-change fields.
 * @returns The existing server-compatible rule-change object.
 */
function changeOf(raw) {
  const action = ADMIN_ACTIONS[Number(raw.action)] ?? 'unknown';
  if (action === 'add_signer') return { action, subject: raw.subject, role: roleName(raw.role) };
  if (action === 'remove_signer') return { action, subject: raw.subject };
  if (action === 'replace_signer')
    return { action, subject: raw.subject, replacement: raw.replacement };
  if (action === 'set_policy') {
    const policy = policyView(raw.policy);
    return {
      action,
      kind: POLICY_KINDS[Number(raw.kind)],
      threshold: policy.threshold,
      required_roles: policy.requiredRoles,
      veto_roles: policy.vetoRoles,
      timelock: policy.timelock,
    };
  }
  return { action, ttl: Number(raw.ttl) };
}

/**
 * The latest rule changes.
 * @param address - Governance contract address on the configured ledger.
 * @param limit - Maximum number of newest records to read.
 * @returns The latest rule changes with their ballots and mapped change fields.
 * @throws Contract, RPC or decoding errors; preimage verification also rejects malformed salts.
 */
export async function listAdminProposals(address, limit = 15) {
  const c = contract(address);
  const count = Number(await c.adminProposalCount());
  return Promise.all(
    latest(count, limit).map(async (id) => {
      const p = await c.getAdminProposal(id);
      return { id, tiId: p.tiId, change: changeOf(p.change), ...ballot(p) };
    }),
  );
}

/**
 * The contract function and arguments that propose `change`: the same
 * mapping as plr.services.governance.admin_call, for a wallet's own key.
 * @param change - Existing rule-change or accreditation-lifespan payload.
 * @param tiDid - The TI whose rules change.
 * @returns The contract method name followed by its arguments.
 * @throws Error for the existing invalid salt or unsupported change validation.
 */
function adminCall(change, tiDid) {
  const tiId = tiIdOf(tiDid);
  switch (change.action) {
    case 'add_signer':
      return ['proposeAddSigner', tiId, change.subject, ROLES[change.role]];
    case 'remove_signer':
      return ['proposeRemoveSigner', tiId, change.subject];
    case 'replace_signer':
      return ['proposeReplaceSigner', tiId, change.subject, change.replacement];
    case 'set_policy':
      return [
        'proposePolicy',
        tiId,
        POLICY_KINDS.indexOf(change.kind),
        change.threshold,
        roleMask(change.required_roles ?? []),
        roleMask(change.veto_roles ?? []),
        change.timelock,
      ];
    case 'set_proposal_ttl':
      return ['proposeProposalTtl', tiId, change.ttl];
    default:
      throw new Error(t('Neznámy úkon: {0}', [change.action]));
  }
}

/**
 * A salt as the contract takes it: bytes32, 0x-prefixed.
 * @param salt - 32-byte salt encoded as hexadecimal text.
 * @returns The lowercase 0x-prefixed bytes32 salt.
 * @throws Error for the existing invalid salt or unsupported change validation.
 */
export function saltBytes32(salt) {
  const hex = String(salt).trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(t('Soľ má 64 hex znakov (32 bajtov).'));
  return `0x${hex.toLowerCase()}`;
}

/**
 * Audit verification (component 10.7).
 *
 * Given the certificate's TI and the id of the credential the holder collected, both
 * disclosed by the back-office, recompute the record's key and compare it with the proposal
 * on chain. The key is computed by the certificate registry, the same code path an
 * independent auditor uses; no salt is involved (the contract's D41).
 * @param address - Governance contract address on the configured ledger.
 * @param proposalId - Ledger status-proposal identifier.
 * @param fields - Disclosed issuer DID and collected credential id.
 * @returns The matches flag and the key the registry computes.
 * @throws Contract, RPC or decoding errors.
 */
export async function verifyRecordKey(address, proposalId, fields) {
  const { issuerDid, certificateId } = fields;
  const [expected, proposal] = await Promise.all([
    (await registry(address)).computeStatusKey(issuerDid, certificateId),
    contract(address).getProposal(proposalId),
  ]);
  return {
    matches:
      String(expected).toLowerCase() === String(proposal.statusKey).toLowerCase() &&
      String(proposal.tiId).toLowerCase() === tiIdOf(issuerDid).toLowerCase(),
    expected,
  };
}

/**
 * A certificate's record on the certificate registry, by the TI that issued it and the id of
 * the credential the holder collected: the only source of truth about it, as every verifier
 * reads it. `standing` is none until the record exists, once the holder collected it.
 * @param address - Governance contract address on the configured ledger.
 * @param issuerDid - DID of the certification body that issued the certificate.
 * @param certificateId - The collected credential's id.
 * @returns The standing, the credential's hash and the record's validity and change times.
 * @throws Contract, RPC or decoding errors.
 */
export async function certificateRecord(address, issuerDid, certificateId) {
  const r = await registry(address);
  const record = await r.certificateStatus(await r.computeStatusKey(issuerDid, certificateId));
  return {
    standing: ['none', 'valid', 'suspended', 'revoked'][Number(record.standing)] ?? 'none',
    credentialHash: record.credentialHash,
    validFrom: Number(record.validFrom),
    validUntil: Number(record.validUntil),
    registeredAt: Number(record.registeredAt),
    changedAt: Number(record.changedAt),
  };
}

/**
 * Check a proposal's reason against the chain (design decisions D22): the category,
 * the note and the salt the back-office disclosed, recomputed by the contract.
 * @param address - Governance contract address on the configured ledger.
 * @param proposalId - Ledger status-proposal identifier.
 * @param fields - Existing operation inputs: {code, note, salt}.
 * @returns The matches flag and expected reason commitment computed by the contract.
 * @throws Contract, RPC or decoding errors; preimage verification also rejects malformed salts.
 */
export async function verifyReason(address, proposalId, fields) {
  const { code, note, salt } = fields;

  const c = contract(address);
  const salted = saltBytes32(salt);
  const [matches, expected] = await Promise.all([
    c.verifyProposalReason(proposalId, code, note ?? '', salted),
    c.computeReasonHash(code, note ?? '', salted),
  ]);
  return { matches, expected };
}

/**
 * Check whether the browser exposes the existing EIP-1193 wallet integration.
 * @returns Whether an injected wallet is available.
 */
export function isBrowserWalletAvailable() {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

// ---------------------------------------------------------------------------
// Voting from a wallet
// ---------------------------------------------------------------------------

/** The chain the contract lives on. A vote sent anywhere else goes nowhere. */
export const LEDGER_CHAIN_ID = Number(import.meta.env.VITE_LEDGER_CHAIN_ID || 1337);

/**
 * The RPC URL a wallet is told to use when it adds the ledger.
 *
 * Not the console's proxy path: the wallet talks to the node itself, from the
 * extension, not from this page's origin.
 */
export const LEDGER_WALLET_RPC = import.meta.env.VITE_LEDGER_WALLET_RPC || 'http://127.0.0.1:8545';

/** Vote -> the contract function, for a status proposal and for a rule change. */
const CONTRACT_METHOD = {
  sign: 'signProposal',
  execute: 'execute',
  cancel: 'cancelProposal',
  expire: 'expireProposal',
};
const ADMIN_METHOD = {
  sign: 'signAdminProposal',
  execute: 'executeAdminProposal',
  cancel: 'cancelAdminProposal',
  expire: 'expireAdminProposal',
};

/**
 * Ask the wallet for an account. Returns the address and the chain it is on.
 * @returns The authorized checksummed address and wallet chainId.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
export async function connectWallet() {
  if (!isBrowserWalletAvailable()) {
    throw new Error(
      t(
        'V prehliadači nie je peňaženka. Nainštalujte napríklad MetaMask a importujte do nej kľúč signatára.',
      ),
    );
  }
  const wallet = new BrowserProvider(window.ethereum);
  const accounts = await wallet.send('eth_requestAccounts', []);
  const network = await wallet.getNetwork();
  return { address: getAddress(accounts[0]), chainId: Number(network.chainId) };
}

/**
 * The account the wallet has already granted, without prompting. Null when it
 * has granted none, so a page reload does not pop the wallet open by itself.
 * @returns The already-authorized address and chainId, or null without an available account.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
export async function currentWallet() {
  if (!isBrowserWalletAvailable()) return null;
  const wallet = new BrowserProvider(window.ethereum);
  const accounts = await wallet.send('eth_accounts', []);
  if (!accounts.length) return null;
  const network = await wallet.getNetwork();
  return { address: getAddress(accounts[0]), chainId: Number(network.chainId) };
}

/**
 * Re-render when the operator switches account or network in the wallet.
 * @param callback - Operation notified when the wallet account or chain changes.
 * @returns A cleanup callback removing the registered wallet listeners.
 */
export function onWalletChange(callback) {
  if (!isBrowserWalletAvailable()) return () => {};
  window.ethereum.on?.('accountsChanged', callback);
  window.ethereum.on?.('chainChanged', callback);
  return () => {
    window.ethereum.removeListener?.('accountsChanged', callback);
    window.ethereum.removeListener?.('chainChanged', callback);
  };
}

/**
 * Switch the wallet to the ledger, adding it first if the wallet lacks it.
 * @returns No return value; the existing operation updates its owned state or storage.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
export async function switchToLedger() {
  const chainId = `0x${LEDGER_CHAIN_ID.toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    // 4902: the wallet does not know this chain yet.
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: t('PLR Besu (lokálna sieť)'),
          rpcUrls: [LEDGER_WALLET_RPC],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        },
      ],
    });
  }
}

/**
 * Send one of the contract's functions from the connected wallet and wait for
 * it to be mined - every wallet vote goes this way.
 *
 * The call is simulated first, so a vote the contract would refuse is refused
 * here, with the contract's reason, before the wallet asks for a signature.
 * @param address - Governance contract address on the configured ledger.
 * @param method - Existing contract method to simulate and submit.
 * @param args - Arguments for the selected contract method.
 * @param onStage - Receives simulation, wallet-confirmation and mining stages and the available transaction hash.
 * @returns The mined transaction hash, falling back to the submitted hash.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
async function sendFromWallet(address, method, args, onStage) {
  const wallet = new BrowserProvider(window.ethereum);
  const network = await wallet.getNetwork();
  if (Number(network.chainId) !== LEDGER_CHAIN_ID) {
    throw new Error(
      t('Peňaženka je na sieti {0}, kontrakt je na {1}.', [network.chainId, LEDGER_CHAIN_ID]),
    );
  }
  const c = new Contract(address, GOVERNANCE_ABI, await wallet.getSigner());
  onStage('simulating');
  await c[method].staticCall(...args);
  onStage('confirm');
  const tx = await c[method](...args);
  onStage('mining', tx.hash);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/**
 * Cast a vote on a status proposal from the connected wallet.
 * @param address - Governance contract address on the configured ledger.
 * @param proposalId - Ledger status-proposal identifier.
 * @param vote - Existing sign, execute, cancel, expire or propose operation.
 * @param onStage - Receives simulation, wallet-confirmation and mining stages and the available transaction hash.
 * @returns The submitted and confirmed status-vote transaction hash.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
export async function castVote(
  address: string,
  proposalId: number,
  vote: string,
  onStage: (name: string, hash?: string) => void = () => {},
) {
  const method = CONTRACT_METHOD[vote];
  if (!method) throw new Error(t('Neznámy úkon: {0}', [vote]));
  // A veto's reasonHash points at an off-chain record of why. A wallet's
  // veto has none the contract could point at - the supervisory authority
  // keeps its own - so it goes without.
  const args = vote === 'cancel' ? [proposalId, ZeroHash] : [proposalId];
  return sendFromWallet(address, method, args, onStage);
}

/**
 * Open, co-sign, execute or veto a rule change from the connected wallet.
 *
 * `request` is {vote: 'propose', change, ti} (ti: the TI whose rules change) or {vote: sign |
 * execute | cancel | expire, id}. The back-office's rule for the certification body's keys does
 * not bind a wallet's own key - the supervisory authority's above all; only
 * the contract's quorum does.
 * @param address - Governance contract address on the configured ledger.
 * @param request - Existing vote request with its change or ledger proposal identifier.
 * @param onStage - Receives simulation, wallet-confirmation and mining stages and the available transaction hash.
 * @returns The submitted and confirmed rule-change transaction hash.
 * @throws Existing wallet refusals, network errors or contract reverts; votes reject the wrong chain before submission.
 */
export async function castAdminVote(
  address: string,
  request,
  onStage: (name: string, hash?: string) => void = () => {},
) {
  if (request.vote === 'propose') {
    const [method, ...args] = adminCall(request.change, request.ti);
    return sendFromWallet(address, method, args, onStage);
  }
  const method = ADMIN_METHOD[request.vote];
  if (!method) throw new Error(t('Neznámy úkon: {0}', [request.vote]));
  return sendFromWallet(address, method, [request.id], onStage);
}

// ---------------------------------------------------------------------------
// The contract's proposal states (component 10.3)
// ---------------------------------------------------------------------------

/**
 * Build localized display names for the contract proposal states.
 * @returns Localized text keyed by proposal state.
 */
function proposalStateLabels() {
  return {
    proposed: t('navrhnutý'),
    // APPROVED: the quorum is reached; executableAt says when the timelock ends.
    approved: t('schválený'),
    executed: t('vykonaný'),
    cancelled: t('vetovaný'),
    expired: t('expirovaný'),
  };
}

/**
 * A proposal state as the contract names it (APPROVED) or the back-office does (approved).
 * @param state - Existing proposal, certificate or presentation state identifier.
 * @returns The localized proposal state, or its original value when unknown.
 */
export const proposalStateLabel = (state) =>
  proposalStateLabels()[String(state).toLowerCase()] ?? state;

// ---------------------------------------------------------------------------
// Why a vote was refused
// ---------------------------------------------------------------------------

/**
 * Build localized explanations of the existing contract and server refusal codes.
 * @returns Localized text keyed by the existing refusal codes.
 */
function refusalReasons() {
  return {
    // The contracts' own errors (CertificateGovernance.sol, CertificateRegistry.sol).
    NotASigner: t('Tento účet nie je signatárom kontraktu pre túto TI.'),
    AlreadySigned: t('Tento signatár už návrh podpísal.'),
    UnknownProposal: t('Návrh s týmto číslom na chaine neexistuje.'),
    ProposalNotOpen: t('Návrh už nie je otvorený — bol vykonaný, vetovaný alebo expiroval.'),
    ProposalAlreadyOpen: t('Pre tento certifikát už je na chaine otvorený iný návrh.'),
    QuorumNotReached: t('Kvórum ešte nie je dosiahnuté, návrh sa nedá vykonať.'),
    TimelockNotElapsed: t('Časový zámok ešte platí. Vykonať sa dá až po jeho uplynutí.'),
    ProposalNotExpirable: t('Návrh ešte neprekročil lehotu, nedá sa označiť za expirovaný.'),
    InvalidSigner: t('Táto adresa nie je platný signatár pre túto zmenu.'),
    DuplicateSigner: t('Táto adresa už je signatárom.'),
    InvalidRole: t('Neznáma rola.'),
    InvalidPolicy: t(
      'Takéto pravidlo sa nedá splniť — povinných rolí je viac než prah, alebo rola nemá žiadny kľúč.',
    ),
    InvalidTtl: t('Platnosť návrhu je mimo rozsahu, ktorý kontrakt pripúšťa.'),
    Unsatisfiable: t('Bez tohto kľúča by sa niektoré pravidlo už nedalo splniť.'),
    CannotVetoOwnRemoval: t(
      'Kľúč nemôže vetovať vlastné odobratie ani výmenu — inak by kompromitovaný kľúč zablokoval rotáciu (komponent 10.9).',
    ),
    VetoNotAllowed: t(
      'Rola tohto kľúča nemá podľa pravidla právo veta. Stiahnuť návrh môže len kľúč, ktorý ho otvoril.',
    ),
    SignerRetired: t(
      'Tento kľúč už signatárom bol a bol odobratý alebo vymenený; znova pridať ho nemožno. Použite nový kľúč.',
    ),
    UnknownCertificate: t(
      'Register certifikátov tento certifikát nepozná — záznam vzniká až po vyzdvihnutí licencie.',
    ),
    NotCertificateIssuer: t('Certifikát vydala iná TI.'),
    CertificateRevoked: t('Odňatý certifikát zostáva odňatý.'),
    UnknownTi: t('Táto TI nie je v kontrakte nastavená.'),
    TiNotActive: t(
      'Akreditácia TI v registri dôveryhodných vydavateľov nie je platná — TI nemôže navrhovať ani vykonávať.',
    ),
    NotDidController: t('Kľúč nie je platným kľúčom DID v registri DID.'),
    // The back-office's (plr.services.governance and views).
    RoleNotPermitted: t(
      'Túto rolu z konzoly nemožno použiť. Orgán dohľadu hlasuje vlastnou peňaženkou.',
    ),
    FourEyes: t(
      'Jeden človek môže dať za certifikačný orgán len jeden podpis — štvor-oký princíp. Podpísať musí niekto iný.',
    ),
    NotApproved: t('Prípad ešte neschválil druhý pracovník v back-office. Vykonať sa dá až potom.'),
    RoleNotAssigned: t(
      'Túto rolu nemáte pridelenú. Pridelí ju správca zaradením do skupiny plr_governance_a alebo plr_governance_b.',
    ),
    ThresholdTooLow: t('Prah pod 2 by znamenal, že rozhoduje jediná rola.'),
    InvalidThreshold: t('Prah nemôže byť vyšší než počet rolí, ktoré majú kľúč.'),
    RoleWithoutKey: t('Povinná rola nemá žiadny kľúč — každé také rozhodnutie by sa zablokovalo.'),
    NoVetoRole: t(
      'Právo veta musí mať aspoň jedna rola s kľúčom — časový zámok, ktorý nikto nemôže prerušiť, nechráni pred ničím (komponent 10.4).',
    ),
    NoChange: t('Pravidlo už má túto hodnotu.'),
    SupervisorFirst: t(
      'Túto zmenu pravidiel môže otvoriť len orgán dohľadu a certifikačný orgán sa k nej pripojí až po jeho podpise.',
    ),
    TimelockOutOfRange: t(
      'Časový zámok je mimo povoleného rozsahu: trvalé odňatie 24 – 48 h (komponent 10.4), pozastavenie a obnovenie bez časového zámku.',
    ),
    TtlOutOfRange: t('Platnosť návrhu je mimo rozsahu, ktorý back-office podpíše.'),
    SupervisorRemoval: t(
      'Posledný kľúč orgánu dohľadu kľúčmi certifikačného orgánu odobrať nemožno.',
    ),
    UnsupportedChange: t('Takúto zmenu back-office neponúka.'),
    SigningRefused: t(
      'Back-office odmietol transakciu podpísať — nezodpovedala úkonu, ktorý schválil. Udalosť je v audit logu.',
    ),
  };
}

/**
 * Why a rule change needs the supervisory authority first, by the back-office's codes.
 * @param code - Existing role, language or refusal code selected by the caller.
 * @returns The localized weakening explanation, or the original unknown code.
 */
export function loosenReason(code) {
  return (
    {
      LowerThreshold: t('nižší prah uvoľňuje multisig'),
      DroppedRole: t('rola, ktorá prestane byť povinná, uvoľňuje multisig'),
      ShorterTimelock: t('kratší časový zámok oslabuje ochranu pred unáhleným rozhodnutím'),
      DroppedVeto: t(
        'rola, ktorá stratí právo veta, oslabuje ochranu pred unáhleným alebo kompromitovaným rozhodnutím',
      ),
      Unanimity: t(
        'jednomyseľnosť robí každú rolu nenahraditeľnou — stratou jej kľúčov sa rozhodovanie zablokuje',
      ),
      NewSigner: t('nový kľúč je nová cesta ku kvóru'),
      RemovedSigner: t('odobratie kľúča mení, kto môže dosiahnuť kvórum'),
      SupervisorKey: t('kľúč orgánu dohľadu rotuje orgán dohľadu'),
    }[code] ?? code
  );
}

/**
 * A sentence for the operator, from a back-office error or a wallet error.
 * @param error - Caught failure from the existing backend, browser or contract operation.
 * @returns A localized known refusal or the original wallet/server error explanation.
 */
export function explainVoteError(error) {
  const reasons = refusalReasons();
  if (error?.reason && reasons[error.reason]) return reasons[error.reason];
  if (error?.status === 502) {
    return t('back-office alebo ledger je nedostupný. Hlas sa nezaznamenal — skúste to znova.');
  }
  if (error?.code === 'ACTION_REJECTED' || error?.info?.error?.code === 4001) {
    return t('Transakciu ste v peňaženke zamietli.');
  }
  const name = error?.revert?.name;
  if (name && reasons[name]) return reasons[name];
  // An address without the contract answers reads with nothing to decode.
  if (error?.code === 'BAD_DATA') {
    return t(
      'Na zadanej adrese nie je kontrakt riadenia registra. Skontrolujte adresu kontraktu v stavovom riadku.',
    );
  }
  return error?.shortMessage || error?.message || String(error);
}
