import { verifySignedIntent } from '../keys/ledger-signing.ts';
import type { Pool, PoolClient } from 'pg';
import { Interface } from 'ethers';
import { GOVERNANCE_ABI } from '../../shared/governance-contract.ts';
import type { ConsoleLedger } from '../lifecycle/console-ledger.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit, type AuditEvent } from './journal.ts';

const abi = new Interface(GOVERNANCE_ABI);
const operations: Record<string, { event: string; admin?: boolean; creates?: boolean }> = {
  proposeAction: { event: 'governance.proposed', creates: true },
  signProposal: { event: 'governance.signed' },
  execute: { event: 'governance.executed' },
  cancelProposal: { event: 'governance.cancelled' },
  expireProposal: { event: 'governance.expired' },
  proposeAddSigner: { event: 'governance.admin_proposed', admin: true, creates: true },
  proposeRemoveSigner: { event: 'governance.admin_proposed', admin: true, creates: true },
  proposeReplaceSigner: { event: 'governance.admin_proposed', admin: true, creates: true },
  proposePolicy: { event: 'governance.admin_proposed', admin: true, creates: true },
  proposeProposalTtl: { event: 'governance.admin_proposed', admin: true, creates: true },
  signAdminProposal: { event: 'governance.admin_signed', admin: true },
  executeAdminProposal: { event: 'governance.admin_executed', admin: true },
  cancelAdminProposal: { event: 'governance.admin_cancelled', admin: true },
  expireAdminProposal: { event: 'governance.admin_expired', admin: true },
};

/**
 * Append one confirmed governance outcome even when HTTP and recovery finish concurrently.
 * @param client - Caller-owned transaction.
 * @param event - Privacy-approved event with an exact confirmed transaction_hash.
 * @returns Completion after appending or finding the same already committed outcome.
 * @throws Audit/database errors or Error if transaction evidence is missing.
 */
export async function appendGovernanceOutcome(client: PoolClient, event: AuditEvent) {
  const hash = event.detail?.transaction_hash;
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new Error('Confirmed governance outcome requires an exact transaction hash.');
  await client.query('SELECT pg_advisory_xact_lock(780264157,hashtext($1))', [hash]);
  const existing = await client.query(
    "SELECT 1 FROM audit_entries WHERE event=$1 AND detail->>'transaction_hash'=$2",
    [event.event, hash],
  );
  if (!existing.rowCount) await appendAudit(client, event);
}

/**
 * Recover confirmed governance outcomes from retained signatures after RPC/process/DB failure.
 * @param database - PostgreSQL pool containing consumed signing intents.
 * @param ledger - Pinned deployment with actual transaction-receipt evidence reads.
 * @returns A bounded worker appending missing governance events at recovery time.
 * @remarks No success is inferred from a local decision, signature or accepted broadcast. The
 * exact signed hash must have a successful confirmed receipt from the pinned contract.
 */
export function postgresSignatureEvidence(database: Pool, ledger: ConsoleLedger) {
  /**
   * Reconcile at most twenty confirmed signed calls without duplicating outcome events.
   * @returns Completion after the batch; unavailable receipts remain pending.
   * @throws Database errors; individual ledger/read failures remain retryable.
   */
  return async function reconcileSignatures() {
    const rows = (
      await database.query(
        `SELECT id FROM ledger_signing_intents WHERE reconciled_at IS NULL
      AND consumed_at IS NOT NULL AND (reconciliation_attempted_at IS NULL OR reconciliation_attempted_at<clock_timestamp()-interval '15 seconds') AND chain_id=$1 AND lower(contract)=lower($2)
      ORDER BY reconciliation_attempted_at NULLS FIRST,consumed_at,id LIMIT 20`,
        [ledger.chainId, ledger.contract],
      )
    ).rows;
    for (const { id } of rows)
      await transaction(database, async (client) => {
        const row = (
          await client.query(
            'SELECT * FROM ledger_signing_intents WHERE id=$1 AND reconciled_at IS NULL FOR UPDATE SKIP LOCKED',
            [id],
          )
        ).rows[0];
        if (!row) return;
        await client.query(
          'UPDATE ledger_signing_intents SET reconciliation_attempted_at=clock_timestamp() WHERE id=$1',
          [id],
        );
        verifySignedIntent(row);
        const signature = (
          await client.query(
            "SELECT actor_id,detail FROM audit_entries WHERE event='ledger.tx_signed' AND detail->>'intent_id'=$1",
            [id],
          )
        ).rows[0];
        if (
          !signature ||
          signature.actor_id !== row.actor_id ||
          signature.detail.key_id !== row.key_id ||
          signature.detail.key_purpose !== row.key_purpose ||
          signature.detail.payload_digest !== row.payload_digest ||
          signature.detail.contract_function !== row.contract_function ||
          Number(signature.detail.chain_id) !== Number(row.chain_id)
        )
          throw new Error('The consumed intent no longer matches its immutable signature journal.');
        const operation = operations[row.contract_function];
        let evidence;
        try {
          evidence = await ledger.confirmedTransaction(row.transaction_hash);
          if (!evidence.confirmed) {
            await ledger.rebroadcast(row.raw_transaction, row.transaction_hash);
            evidence = await ledger.confirmedTransaction(row.transaction_hash);
          }
        } catch {
          return;
        }
        if (!evidence.confirmed) return;
        if (!operation) {
          await client.query(
            'UPDATE ledger_signing_intents SET reconciled_at=clock_timestamp() WHERE id=$1',
            [id],
          );
          return;
        }
        if (!evidence.failed) {
          const decoded = abi.parseTransaction({ data: row.calldata });
          if (!decoded) throw new Error('The consumed signature calldata is invalid.');
          const number = operation.creates ? evidence.createdId : String(decoded.args[0]);
          if (!number) throw new Error('Confirmed creation evidence has no proposal number.');
          if (operation.admin)
            await client.query(
              'UPDATE ledger_signing_intents SET admin_proposal_id=$2 WHERE id=$1',
              [id, number],
            );
          const existing = await client.query(
            "SELECT 1 FROM audit_entries WHERE event=$1 AND detail->>'transaction_hash'=$2",
            [operation.event, row.transaction_hash],
          );
          if (!existing.rowCount) {
            let change;
            let ti;
            try {
              if (operation.admin) ({ change, issuerDid: ti } = await ledger.adminProposal(number));
            } catch {
              return;
            }
            const local = operation.admin
              ? undefined
              : (
                  await client.query(
                    `SELECT p.id,c.credential_id FROM certificate_status_proposals p
            JOIN registered_certificates c ON c.id=p.certificate_id WHERE p.onchain_chain_id=$1 AND lower(p.onchain_contract)=lower($2)
            AND (p.onchain_proposal_id=$3 OR ($4::bytea IS NOT NULL AND p.reason_hash=$4))`,
                    [
                      ledger.chainId,
                      ledger.contract,
                      number,
                      // proposeAction(tiId, statusKey, actionType, reasonHash)
                      operation.creates
                        ? Buffer.from(String(decoded.args[3]).slice(2), 'hex')
                        : null,
                    ],
                  )
                ).rows[0];
            await appendGovernanceOutcome(client, {
              event: operation.event,
              actor: row.actor_id ?? undefined,
              proposalId: local?.id,
              credentialId: local?.credential_id,
              detail: {
                ...(operation.admin
                  ? { admin_proposal_id: number, admin_change: change, ti }
                  : { onchain_proposal_id: number }),
                signer_role: row.key_purpose === 'governance_role_b' ? 'B' : 'A',
                transaction_hash: row.transaction_hash,
                governance_contract: ledger.contract,
              },
            });
          }
        }
        await client.query(
          'UPDATE ledger_signing_intents SET reconciled_at=clock_timestamp() WHERE id=$1',
          [id],
        );
      });
  };
}
