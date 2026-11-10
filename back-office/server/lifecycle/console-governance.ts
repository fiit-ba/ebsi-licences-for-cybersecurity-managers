import { enqueueCommitted } from '../background/queue.ts';
import { postgresSignatureEvidence, appendGovernanceOutcome } from '../audit/signature-evidence.ts';
import { withGovernanceSigning } from '../keys/ledger-signing.ts';
import { governanceInput } from './governance-input.ts';
import type { Pool, PoolClient } from 'pg';
import { Interface } from 'ethers';
import { GOVERNANCE_ABI } from '../../shared/governance-contract.ts';
import { transaction } from '../adapters/transaction.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { authorizeGovernance } from './governance-access.ts';
import {
  adminChange,
  assessAdminChange,
  checkAdminChange,
  governanceBounds,
  type GovernanceBounds,
} from './admin-policy.ts';
import { adminCall, type ConsoleLedger } from './console-ledger.ts';
import { postgresStatusProposals } from './proposals.ts';

const voteFunctions = {
  sign: 'signProposal',
  execute: 'execute',
  cancel: 'cancelProposal',
  expire: 'expireProposal',
};
const adminFunctions = {
  sign: 'signAdminProposal',
  execute: 'executeAdminProposal',
  cancel: 'cancelAdminProposal',
  expire: 'expireAdminProposal',
};
const events = {
  propose: 'proposed',
  sign: 'signed',
  execute: 'executed',
  cancel: 'cancelled',
  expire: 'expired',
};
const abi = new Interface(GOVERNANCE_ABI);

/**
 * Validate an existing decimal on-chain proposal identifier.
 * @param input - Untrusted JSON field.
 * @returns Canonical decimal ID.
 * @throws IssuanceError for an invalid identifier.
 */
function proposalId(input: unknown) {
  if (typeof input !== 'string' || !/^[1-9][0-9]{0,77}$/.test(input))
    throw new IssuanceError(400, 'InvalidFields', 'Invalid proposal identifier.');
  return input;
}

/**
 * Project a contract custom error without exposing provider credentials or internals.
 * @param error - Ethers/RPC failure.
 * @returns An HTTP-compatible contract refusal or dependency failure.
 */
export function governanceFailure(error: unknown) {
  if (error instanceof IssuanceError) return error;
  const value = error as {
    data?: string;
    info?: { error?: { data?: string } };
    revert?: { name?: string };
  };
  let name = value?.revert?.name;
  try {
    name ??= abi.parseError(value?.data ?? value?.info?.error?.data ?? '')?.name;
  } catch {
    /* Not a contract error. */
  }
  return new IssuanceError(
    name ? 409 : 502,
    name ?? '',
    name
      ? `The governance contract refused the operation: ${name}.`
      : 'The governance ledger is unavailable.',
  );
}

/**
 * Restore existing governance HTTP responsibilities using live memberships and the current contract.
 * @param database - PostgreSQL pool.
 * @param options - Optional pinned ledger, console role allowlist and policy bounds.
 * @returns Roles, votes, admin/check and external-wallet sync operations.
 * @remarks Signer-only memberships do not grant registry/audit rights. C stays outside the server.
 */
export function postgresConsoleGovernance(
  database: Pool,
  options: {
    ledger?: ConsoleLedger;
    consoleRoles?: readonly string[];
    bounds?: GovernanceBounds;
  } = {},
) {
  const { ledger, bounds = governanceBounds() } = options;
  const permitted = (options.consoleRoles ?? ['A', 'B']).filter((role) =>
    ['A', 'B'].includes(role),
  );
  const proposals = postgresStatusProposals(database);
  /**
   * Require a configured ledger for operations that read or write it.
   * @returns Pinned ledger adapter.
   * @throws IssuanceError when governance is disabled.
   */
  function enabled() {
    if (!ledger) throw new IssuanceError(409, '', 'No governance contract is configured.');
    return ledger;
  }
  /**
   * Find the local case for a number on this exact deployment.
   * @param client - Caller connection.
   * @param id - Validated on-chain number.
   * @returns The local case, if one is pinned to the current deployment.
   * @throws Database errors.
   */
  async function caseFor(client: Pick<PoolClient, 'query'>, id: string) {
    return (
      await client.query(
        `SELECT p.*,c.credential_id FROM certificate_status_proposals p JOIN registered_certificates c ON c.id=p.certificate_id
      WHERE p.onchain_proposal_id=$1 AND lower(p.onchain_contract)=lower($2) AND p.onchain_chain_id=$3`,
        [id, enabled().contract, enabled().chainId],
      )
    ).rows[0];
  }
  /**
   * Persist a re-read request without relying on a broker being available.
   * @param id - Existing proposal number on the configured deployment.
   * @returns Sync response; true means a durable worker request exists.
   * @throws Database errors.
   */
  /**
   * The TI a new rule change is for: the one named, or the only TI set up on the contract.
   * @param named - Validated `ti` input.
   * @returns The TI's DID.
   * @throws IssuanceError when several TIs could be meant.
   */
  async function tiFor(named: unknown) {
    if (typeof named === 'string' && named) return named;
    const { rows } = await database.query(
      "SELECT did FROM accredited_organizations WHERE kind='ti' AND governance_configured_at IS NOT NULL AND revoked_at IS NULL ORDER BY did",
    );
    if (rows.length === 1) return rows[0].did as string;
    throw new IssuanceError(400, 'InvalidFields', 'Name the TI whose rules change (ti).');
  }
  /**
   * Ask the worker to re-read a proposal the back-office keeps a case for, if it is open.
   * @param id - On-chain proposal id.
   * @returns The case id and whether a reconciliation was queued.
   */
  async function sync(id: string) {
    const row = await caseFor(database, id);
    const open = row && !row.applied_at && !row.closed_at && row.decision !== 'rejected';
    if (open)
      await database.query(
        'UPDATE certificate_status_proposals SET delivery_attempted_at=NULL WHERE id=$1',
        [row.id],
      );
    if (open)
      await enqueueCommitted({ operation: 'reconcile-governance-proposal', proposalId: row.id });
    return { case_id: row?.id ?? null, reconciling: Boolean(open) };
  }
  return {
    reconcileSignatures: ledger ? postgresSignatureEvidence(database, ledger) : async () => {},
    /**
     * Report deployment keys, live operator memberships and administration limits.
     * @param actor - Current authenticated account ID.
     * @returns Roles endpoint JSON; address outages do not prevent rendering.
     * @throws Database errors.
     */
    async roles(actor: number) {
      const account = await postgresAccounts(database).byId(actor);
      let addresses: Record<string, string> = {};
      let ti = '';
      const tis: { did: string; name: string; addresses: Record<string, string> }[] = [];
      if (ledger) {
        const { rows } = await database.query(
          "SELECT did,name,account_id FROM accredited_organizations WHERE kind='ti' AND governance_configured_at IS NOT NULL AND revoked_at IS NULL ORDER BY name,did",
        );
        for (const row of rows) {
          let keys: Record<string, string> = {};
          try {
            keys = await ledger.addresses(row.did);
          } catch {
            /* labels are optional. */
          }
          tis.push({ did: row.did, name: row.name, addresses: keys });
          // The operator's own TI first; otherwise the only one.
          if (row.account_id === actor || rows.length === 1) {
            addresses = keys;
            ti = row.did;
          }
        }
      }
      return {
        enabled: Boolean(ledger),
        roles:
          ledger && account?.active && !account.revoked_at
            ? (account.governance_roles?.filter((role) => permitted.includes(role)) ?? [])
            : [],
        console_roles: ledger ? permitted : [],
        // The TI shown first, and its A and B keys.
        ti,
        addresses,
        tis,
        approver_role: 'B',
        supervisor_role: 'C',
        bounds,
      };
    },
    /**
     * Vote on a status proposal, binding B's first signature to independent local approval.
     * @param actor - Current authenticated operator ID.
     * @param input - Existing proposal_id, vote and role fields.
     * @returns HTTP status and vote response.
     * @throws IssuanceError for invalid input, missing current signer authority, self approval or contract/provider failure; DB errors.
     */
    async vote(actor: number, input: Record<string, unknown>) {
      input = governanceInput('vote', input);
      const adapter = enabled();
      const id = proposalId(input.proposal_id);
      const vote = input.vote as keyof typeof voteFunctions;
      if (!Object.hasOwn(voteFunctions, vote))
        throw new IssuanceError(400, 'InvalidFields', 'Unknown governance vote.');
      const role = String(input.role ?? '').toUpperCase();
      await transaction(database, (client) => authorizeGovernance(client, actor, role, permitted));
      const current = await caseFor(database, id);
      const unapproved =
        current && !current.applied_at && !current.closed_at && current.decision === null;
      if (unapproved && vote === 'sign' && role === 'B') {
        await proposals.decide(actor, current.id, 'approved', true);
        return {
          status: 202,
          body: {
            proposal_id: id,
            vote,
            role,
            approved: true,
            case_id: current.id,
            transaction_hash: '',
          },
        };
      }
      if (unapproved && vote === 'execute')
        throw new IssuanceError(
          409,
          'NotApproved',
          'The case has not been independently approved.',
        );
      try {
        return await transaction(database, async (client) => {
          await authorizeGovernance(client, actor, role, permitted);
          const args = vote === 'cancel' ? [id, '0x' + '00'.repeat(32)] : [id];
          // The proposal's TI decides with its own keys.
          const issuerDid = await adapter.proposalIssuer(id);
          const result = await withGovernanceSigning(
            { actor, proposalId: current?.id, credentialId: current?.credential_id },
            () => adapter.transact(issuerDid, role, voteFunctions[vote], args),
          );
          await appendGovernanceOutcome(client, {
            event: `governance.${events[vote]}`,
            actor,
            credentialId: current?.credential_id,
            proposalId: current?.id,
            detail: {
              onchain_proposal_id: id,
              signer_role: role,
              transaction_hash: result.transactionHash,
              governance_contract: adapter.contract,
            },
          });
          return {
            status: 200,
            body: {
              proposal_id: id,
              vote,
              role,
              approved: false,
              transaction_hash: result.transactionHash,
              ...(await sync(id)),
            },
          };
        });
      } catch (error) {
        throw governanceFailure(error);
      }
    },
    /**
     * Ask the existing body-key policy about a proposed or currently open rule change.
     * @param input - Existing change or admin_proposal_id and optional signing role.
     * @returns Allowed/refused policy verdict without sending a transaction.
     * @throws IssuanceError for malformed input or unavailable ledger; DB errors.
     */
    async check(input: Record<string, unknown>) {
      input = governanceInput('check', input);
      const adapter = enabled();
      let change;
      let loosens: { code: string; detail: string }[] = [];
      try {
        const view = input.admin_proposal_id
          ? await adapter.adminProposal(proposalId(input.admin_proposal_id))
          : undefined;
        change = view?.change ?? adminChange((input.change ?? {}) as Record<string, unknown>);
        const config = view?.configuration ?? (await adapter.configuration(await tiFor(input.ti)));
        loosens = assessAdminChange(change, config, bounds);
        checkAdminChange(
          change,
          config,
          String(input.role ?? '').toUpperCase(),
          view?.rolesSigned ?? [],
          bounds,
        );
        return {
          allowed: true,
          reason: '',
          detail: loosens.map((reason) => reason.detail).join(' '),
          loosens: loosens.map((reason) => reason.code),
          supervisor_first: loosens.length > 0,
          change,
        };
      } catch (error) {
        if (error instanceof IssuanceError && error.status === 403)
          return {
            allowed: false,
            ...error.body,
            loosens: loosens.map((reason) => reason.code),
            change: change ?? null,
          };
        throw governanceFailure(error);
      }
    },
    /**
     * Propose, independently co-sign, execute, veto or expire an existing rule change.
     * @param actor - Current authenticated operator ID.
     * @param input - Existing administration request body.
     * @returns Change/vote/hash response after confirmation.
     * @throws IssuanceError for policy, four-eyes, authorization, input or chain failure; DB errors.
     */
    async admin(actor: number, input: Record<string, unknown>) {
      input = governanceInput('admin', input);
      const adapter = enabled();
      const vote = input.vote as keyof typeof events;
      if (!Object.hasOwn(events, vote))
        throw new IssuanceError(400, 'InvalidFields', 'Unknown administration vote.');
      const role = String(input.role ?? '').toUpperCase();
      await postgresSignatureEvidence(database, adapter)();
      try {
        return await transaction(database, async (client) => {
          await authorizeGovernance(client, actor, role, permitted);
          // This lock serializes all votes by this human across both body role keys.
          await client.query('SELECT pg_advisory_xact_lock(780264153,$1)', [actor]);
          let id = vote === 'propose' ? '' : proposalId(input.admin_proposal_id);
          const view = vote === 'propose' ? undefined : await adapter.adminProposal(id);
          const change =
            view?.change ?? adminChange((input.change ?? {}) as Record<string, unknown>);
          const issuerDid = view?.issuerDid ?? (await tiFor(input.ti));
          if (vote === 'sign') {
            const existing = await client.query(
              `SELECT 1 FROM audit_entries WHERE actor_id=$1 AND event IN ('governance.admin_proposed','governance.admin_signed') AND detail->>'admin_proposal_id'=$2 AND lower(detail->>'governance_contract')=lower($3)`,
              [actor, id, adapter.contract],
            );
            const signature = await client.query(
              `SELECT 1 FROM ledger_signing_intents WHERE actor_id=$1 AND (admin_proposal_id=$2 OR admin_proposal_id IS NULL) AND lower(contract)=lower($3) AND consumed_at IS NOT NULL AND contract_function IN ('signAdminProposal','proposeAddSigner','proposeRemoveSigner','proposeReplaceSigner','proposePolicy','proposeProposalTtl')`,
              [actor, id, adapter.contract],
            );
            if (existing.rowCount || signature.rowCount)
              throw new IssuanceError(
                403,
                'FourEyes',
                "You have already put one of the body's signatures on this change.",
              );
            if (view!.state !== 'proposed')
              throw new IssuanceError(
                403,
                'ProposalNotOpen',
                'This rule change is no longer open.',
              );
          }
          if (vote === 'propose' || vote === 'sign')
            checkAdminChange(
              change,
              view?.configuration ?? (await adapter.configuration(issuerDid)),
              role,
              view?.rolesSigned ?? [],
              bounds,
            );
          const call =
            vote === 'propose'
              ? adminCall(change, issuerDid)
              : { functionName: adminFunctions[vote], args: [id] };
          const result = await withGovernanceSigning(
            { actor, adminId: vote === 'propose' ? undefined : id },
            () => adapter.transact(issuerDid, role, call.functionName, call.args),
          );
          if (vote === 'propose') {
            if (!result.id)
              throw new Error('The created rule-change proposal could not be identified.');
            id = result.id;
          }
          await database.query(
            'UPDATE ledger_signing_intents SET admin_proposal_id=$2 WHERE transaction_hash=$1 AND actor_id=$3',
            [result.transactionHash, id, actor],
          );
          await appendGovernanceOutcome(client, {
            event: `governance.admin_${events[vote]}`,
            actor,
            detail: {
              admin_proposal_id: id,
              admin_change: change,
              ti: issuerDid,
              signer_role: role,
              transaction_hash: result.transactionHash,
              governance_contract: adapter.contract,
            },
          });
          return {
            admin_proposal_id: id,
            vote,
            role,
            change,
            ti: issuerDid,
            transaction_hash: result.transactionHash,
          };
        });
      } catch (error) {
        throw governanceFailure(error);
      }
    },
    /**
     * Queue a trusted re-read after a vote cast by an external supervisory wallet.
     * @param input - Existing contract proposal_id; callers cannot supply its outcome.
     * @returns Local case and durable reconciliation request state.
     * @throws IssuanceError for invalid input/disabled governance; DB errors.
     */
    async sync(input: Record<string, unknown>) {
      input = governanceInput('sync', input);
      enabled();
      return sync(proposalId(input.proposal_id));
    },
  };
}
