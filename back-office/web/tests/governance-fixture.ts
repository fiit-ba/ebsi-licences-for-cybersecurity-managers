import { Contract, ZeroHash, keccak256, toBeHex, toUtf8Bytes, type EventLog } from 'ethers';
import type { Page } from '@playwright/test';
import { apiFixture, type Row } from './api-fixture.ts';
import { GOVERNANCE_ABI } from '../../shared/governance-contract.ts';
import { testLedger } from '../../server/lifecycle/fixtures/ledger.ts';

/** JSON-RPC request forwarded to the test ledger. */
type RpcRequest = { id: number; method: string; params?: unknown[] };
/** Browser wallet request forwarded through the isolated EIP-1193 bridge. */
type WalletRequest = { method: string; params?: unknown[] };

/**
 * Set up a fresh TI on the governance contract as deployed, and connect browser reads and votes to
 * it: the console's back-office role B, or an external wallet holding the supervisory
 * authority's key (role C, through its DID).
 * @param page - Isolated browser page receiving the JSON-RPC and wallet bridges.
 * @param options - Existing back-office-role or external-wallet signing path and optional wrong chain.
 * @returns The contract, the TI and its keys, and captured API/wallet calls for behavioral assertions.
 * @throws Ledger, contract or Playwright setup errors.
 * @remarks Only the test ledger is changed (BACK_OFFICE_TEST_LEDGER, or one started here). No
 * production signer or ledger is used.
 */
export async function governanceFixture(
  page: Page,
  options: { wallet?: boolean; wrongChain?: boolean } = {},
) {
  const network = await testLedger();
  const ti = await network.newTi();
  const [a, b] = ti.keys;
  const c = network.supervisor;
  const tiId = keccak256(toUtf8Bytes(ti.did));
  const governance = new Contract(network.governance, GOVERNANCE_ABI, network.provider);
  const address = network.governance;
  /**
   * Record a certificate of the TI and propose its suspension with key A.
   * @param suffix - Distinguishes the reason.
   * @param id - The certificate's `vc.id`; a fresh one by default.
   * @returns The proposal id.
   */
  const makeProposal = async (suffix: string, id?: string) => {
    const statusKey = await network.recordCertificate(ti, id);
    const receipt = await (
      await (governance.connect(a) as Contract).proposeAction(
        tiId,
        statusKey,
        0,
        keccak256(toUtf8Bytes('ui-cutover-' + suffix)),
      )
    ).wait();
    const created = receipt.logs.find(
      (log: EventLog) => 'fragment' in log && log.fragment.name === 'ProposalCreated',
    ) as EventLog;
    return Number(created.args.proposalId);
  };
  const proposal = await makeProposal('first');
  // The console judges timelocks by the browser's clock. The test ledger's clock runs ahead once
  // server checks have advanced it, so the page's clock follows the chain's, an hour on.
  const latest = await network.provider.getBlock('latest');
  await page.clock.setFixedTime(new Date((latest!.timestamp + 3600) * 1000));
  const rpcCalls: string[] = [];
  const walletCalls: WalletRequest[] = [];
  let connected = false;
  let wrongChain = options.wrongChain ?? false;
  const keys = { A: a.address, B: b.address };
  const state = await apiFixture(page, {
    roles: ['plr_status_manager', 'plr_auditor'],
    override: async (path, body) => {
      if (path === '/registry/governance/roles')
        return {
          json: {
            enabled: true,
            roles: ['B'],
            console_roles: ['A', 'B'],
            ti: ti.did,
            addresses: keys,
            tis: [{ did: ti.did, name: 'Testovacia TI', addresses: keys }],
            approver_role: 'B',
            supervisor_role: 'C',
            bounds: {
              timelock: {
                suspend: [0, 0],
                reinstate: [0, 0],
                revoke: [86400, 172800],
                admin: [0, 7776000],
              },
              ttl: [86400, 31536000],
            },
          },
        };
      if (path === '/registry/governance/admin/check')
        return { json: { allowed: true, supervisor_first: false, loosens: [] } };
      if (path === '/registry/governance/sync')
        return { json: { proposal_id: body.proposal_id, synced: true } };
      if (path === '/registry/governance/vote') {
        const methods: Record<string, string> = {
          sign: 'signProposal',
          execute: 'execute',
          cancel: 'cancelProposal',
          expire: 'expireProposal',
        };
        const args = body.vote === 'cancel' ? [body.proposal_id, ZeroHash] : [body.proposal_id];
        const transaction = await (governance.connect(b) as Contract)[methods[String(body.vote)]](
          ...args,
        );
        await transaction.wait();
        return { json: { transaction_hash: transaction.hash, approved: body.vote === 'sign' } };
      }
      if (path === '/registry/governance/admin') {
        const signer = governance.connect(b) as Contract;
        let transaction;
        if (body.vote === 'propose') {
          const change = body.change as Row;
          if (change.action === 'set_proposal_ttl')
            transaction = await signer.proposeProposalTtl(tiId, change.ttl);
          else throw new Error('Unexpected test rule change.');
        } else {
          const methods: Record<string, string> = {
            sign: 'signAdminProposal',
            execute: 'executeAdminProposal',
            cancel: 'cancelAdminProposal',
          };
          transaction = await signer[methods[String(body.vote)]](body.admin_proposal_id);
        }
        await transaction.wait();
        return { json: { transaction_hash: transaction.hash } };
      }
      return undefined;
    },
  });
  state.profile.governance_contract = address;
  await page.route('**/api-ledger', async (route) => {
    const payload = route.request().postDataJSON() as RpcRequest | RpcRequest[];
    const execute = async (request: RpcRequest) => {
      rpcCalls.push(request.method);
      try {
        return {
          id: request.id,
          jsonrpc: '2.0',
          result: await network.provider.send(request.method, request.params ?? []),
        };
      } catch (error) {
        return {
          id: request.id,
          jsonrpc: '2.0',
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        };
      }
    };
    await route.fulfill({
      json: Array.isArray(payload)
        ? await Promise.all(payload.map(execute))
        : await execute(payload),
    });
  });
  if (options.wallet) {
    await page.exposeFunction('atestWalletRequest', async (request: WalletRequest) => {
      walletCalls.push(request);
      if (request.method === 'eth_requestAccounts') {
        connected = true;
        return [c.address];
      }
      if (request.method === 'eth_accounts') return connected ? [c.address] : [];
      if (request.method === 'eth_chainId') return wrongChain ? '0x1' : toBeHex(network.chainId);
      if (request.method === 'wallet_switchEthereumChain') {
        wrongChain = false;
        return null;
      }
      // The development key is one of the ledger's own accounts, as in a wallet.
      return network.provider.send(request.method, request.params ?? []);
    });
    await page.addInitScript(() => {
      const bridge = window as unknown as {
        atestWalletRequest: (request: WalletRequest) => Promise<unknown>;
        ethereum: unknown;
      };
      bridge.ethereum = {
        request: (request: WalletRequest) => bridge.atestWalletRequest(request),
        on: () => undefined,
        removeListener: () => undefined,
      };
    });
  }
  return {
    state,
    governance,
    ti,
    tiId,
    keys: { a, b, c },
    address,
    proposal,
    rpcCalls,
    walletCalls,
    makeProposal,
  };
}
