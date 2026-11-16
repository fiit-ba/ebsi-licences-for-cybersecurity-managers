import { decisionDigest } from './decisions.ts';
import type { Protection } from '../issuance/protection.ts';
import type { Pool } from 'pg';
import { keccak256, Transaction } from 'ethers';
import { appendAudit, auditHash } from './journal.ts';
import { timestampId } from './timestamp-ledger.ts';
import type { TimestampLedger, TimestampProof } from './timestamp-ledger.ts';

/** Persisted timestamp intent and the journal entry it anchors. */
interface AnchorIntentRow {
  id: string;
  entry_id: string | null;
  decision_id: string | null;
  decision_encrypted: Buffer | null;
  credential_id: string | null;
  proposal_id: string | null;
  digest: Buffer;
  entry_hash: Buffer;
  previous_hash: Buffer;
  payload: string;
  chain_id: string | null;
  contract: string | null;
  signer_address: string | null;
  raw_transaction: string | null;
  transaction_hash: string | null;
  transaction_nonce: string | null;
  commit_transaction: string | null;
  commit_hash: string | null;
}

/** Result of reconciling or preparing the next timestamp intent. */
type PreparedAnchor = { done: true } | { waiting: true } | { row: AnchorIntentRow; digest: string };

/**
 * Create an ordered timestamp queue with durable signed intents before broadcast.
 *
 * @param database - PostgreSQL pool.
 * @param ledger - Dedicated timestamp signer/deployment adapter.
 * @param protection - Installation key for decision snapshot verification.
 * @returns A worker handling at most 20 oldest eligible anchors.
 */
export function postgresAnchorDelivery(
  database: Pool,
  ledger: TimestampLedger,
  protection?: Protection,
) {
  /**
   * Reconcile or broadcast stored timestamp transactions in nonce order.
   * @param anchorId - Optional wake-up anchor; earlier retained nonces are always reconciled first.
   *
   * @returns Completion of the bounded batch, or early return when another worker holds the lock.
   * @throws Database errors if queue or failure bookkeeping cannot complete.
   * @remarks A session advisory lock serializes the queue. Uncertain broadcasts retain the same raw
   * bytes, hash and nonce for retry.
   */
  async function deliverAuditAnchors(anchorId?: string) {
    if (
      anchorId &&
      !(
        await database.query('SELECT 1 FROM audit_anchors WHERE id=$1 AND confirmed_at IS NULL', [
          anchorId,
        ])
      ).rowCount
    )
      return;
    const client = await database.connect();
    let locked = false;
    let failed = false;
    /**
     * Run one timestamp-queue phase in a transaction on the held connection.
     *
     * @param work - Async work using the existing locked connection.
     * @returns The work result after commit.
     * @throws The work/database error; rollback errors may replace it.
     */
    async function commit<T>(work: () => Promise<T>): Promise<T> {
      await client.query('BEGIN');
      try {
        const result = await work();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    /**
     * Persist timestamp evidence and append its journal event.
     *
     * @param row - Locked anchor intent with event identifiers.
     * @param proof - Confirmed block number/hash and timestamp.
     * @returns Completion of the update and journal append.
     * @throws Database errors if a query, lock or commit fails.
     */
    async function confirm(row: AnchorIntentRow, proof: TimestampProof) {
      await client.query(
        `
        UPDATE audit_anchors SET confirmed_at = clock_timestamp(), delivery_failed = false,
          attempted_at = clock_timestamp(), attempts = attempts + 1, block_number = $2, block_hash = $3, timestamped_at = $4
        WHERE id = $1
      `,
        [row.id, proof.blockNumber, proof.blockHash, proof.timestamp],
      );
      if (row.decision_id)
        await client.query(
          'UPDATE decision_anchors SET timestamp_id=$2,transaction_hash=$3,anchored_at=clock_timestamp() WHERE id=$1',
          [row.decision_id, timestampId('0x' + row.digest.toString('hex')), row.transaction_hash],
        );
      await appendAudit(client, {
        event: 'audit.timestamp_anchored',
        credentialId: row.credential_id ?? undefined,
        proposalId: row.proposal_id ?? undefined,
        detail: {
          anchor_id: row.id,
          entry_id: row.entry_id,
          decision_id: row.decision_id,
          digest: '0x' + row.digest.toString('hex'),
          timestamp_id: timestampId('0x' + row.digest.toString('hex')),
          chain_id: ledger.chainId,
          contract: ledger.contract,
          block_number: proof.blockNumber,
          block_hash: proof.blockHash,
        },
      });
    }
    try {
      const {
        rows: [guard],
      } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(783120451) AS locked',
      );
      locked = guard.locked;
      if (!locked) return;
      for (let count = 0; count < 20; count++) {
        // Never allocate another nonce while an earlier broadcast is uncertain.
        const {
          rows: [next],
        } = await client.query(`
          SELECT id, attempted_at > clock_timestamp() - interval '15 seconds' AS waiting
          FROM audit_anchors WHERE confirmed_at IS NULL AND (raw_transaction IS NOT NULL OR attempts < 50)
          ORDER BY created_at, entry_id NULLS LAST, id LIMIT 1
        `);
        if (!next || (next.waiting && !anchorId)) break;
        let failureContext: AnchorIntentRow | undefined;
        try {
          const prepared = await commit<PreparedAnchor | undefined>(async () => {
            const {
              rows: [row],
            } = await client.query<AnchorIntentRow>(
              `
              SELECT anchor.*, e.entry_hash, e.previous_hash, e.payload, COALESCE(e.credential_id,d.credential_id) AS credential_id,
                COALESCE(e.proposal_id,d.proposal_id) AS proposal_id,d.decision_encrypted
              FROM audit_anchors anchor LEFT JOIN audit_entries e ON e.id = anchor.entry_id
              LEFT JOIN decision_anchors d ON d.id=anchor.decision_id
              WHERE anchor.id = $1 AND anchor.confirmed_at IS NULL FOR UPDATE OF anchor
            `,
              [next.id],
            );
            if (!row) return;
            failureContext = row;
            if (row.decision_id) {
              if (
                !protection ||
                !row.decision_encrypted ||
                decisionDigest(await protection.open(row.decision_id, row.decision_encrypted)) !==
                  row.digest.toString('hex')
              )
                throw new Error('The private decision does not match its anchored digest.');
            } else if (
              !row.digest.equals(row.entry_hash) ||
              !row.digest.equals(auditHash(row.previous_hash, row.payload))
            ) {
              throw new Error('The source audit entry does not match the anchor.');
            }
            if (
              row.chain_id !== null &&
              (Number(row.chain_id) !== ledger.chainId ||
                row.contract !== ledger.contract ||
                row.signer_address !== ledger.signerAddress)
            )
              throw new Error('The anchor belongs to a different timestamp deployment.');
            // Pin and commit identity before any external submission. Preparing
            // an unsigned intent or KMS signature has no ledger side effect.
            await client.query(
              `
              UPDATE audit_anchors SET chain_id = $2, contract = $3, signer_address = $4 WHERE id = $1
            `,
              [row.id, ledger.chainId, ledger.contract, ledger.signerAddress],
            );
            const digest = '0x' + row.digest.toString('hex');
            const observation = await ledger.observe(digest);
            if (observation.state === 'confirmed') {
              await confirm(row, observation.proof);
              return { done: true };
            }
            if (observation.state === 'pending') {
              await client.query(
                `UPDATE audit_anchors SET attempted_at = clock_timestamp(), attempts = attempts + 1 WHERE id = $1`,
                [row.id],
              );
              return { waiting: true };
            }
            if (row.raw_transaction === null) {
              // The commitment and the timestamp revealing it, signed together (EBSI's
              // Timestamp contract takes a hash only after a matured commitment to it).
              const signed = await ledger.prepare(digest);
              if (
                keccak256(signed.raw) !== signed.hash ||
                keccak256(signed.commitRaw) !== signed.commitHash
              )
                throw new Error('Timestamp transaction hash does not match.');
              await client.query(
                `
                UPDATE audit_anchors SET raw_transaction = $2, transaction_hash = $3, transaction_nonce = $4,
                  commit_transaction = $5, commit_hash = $6, prepared_at = clock_timestamp() WHERE id = $1
              `,
                [
                  row.id,
                  signed.raw,
                  signed.hash,
                  signed.nonce,
                  signed.commitRaw,
                  signed.commitHash,
                ],
              );
              row.raw_transaction = signed.raw;
              row.transaction_hash = signed.hash;
              row.transaction_nonce = signed.nonce;
              row.commit_transaction = signed.commitRaw;
              row.commit_hash = signed.commitHash;
              for (const [raw, name] of [
                [signed.commitRaw, 'commitTimestampHashes'],
                [signed.raw, 'timestampHashes'],
              ])
                await appendAudit(client, {
                  event: 'ledger.tx_signed',
                  credentialId: row.credential_id,
                  proposalId: row.proposal_id,
                  detail: {
                    intent_id: row.id,
                    key_id: ledger.signerAddress,
                    key_purpose: 'timestamp_transactions',
                    contract_function: name,
                    chain_id: ledger.chainId,
                    payload_digest: Transaction.from(raw).unsignedHash,
                  },
                });
            }
            return { row, digest };
          });
          if (!prepared || 'done' in prepared) {
            if (next.id === anchorId) break;
            continue;
          }
          if ('waiting' in prepared) break;
          // The signed bytes are now durable. Retries after RPC or DB failure
          // rebroadcast the same nonce and hash rather than sign a new intent.
          const finished = await commit(async () => {
            await client.query('SELECT id FROM audit_anchors WHERE id = $1 FOR UPDATE', [next.id]);
            const { row, digest } = prepared;
            let observation = await ledger.observe(digest);
            if (observation.state === 'missing') {
              try {
                await ledger.broadcast(digest, {
                  raw: row.raw_transaction!,
                  hash: row.transaction_hash!,
                  nonce: String(row.transaction_nonce),
                  commitRaw: row.commit_transaction ?? '',
                  commitHash: row.commit_hash ?? '',
                });
              } catch {
                observation = await ledger.observe(digest);
                if (observation.state === 'missing')
                  throw new Error('Timestamp broadcast is not yet reconciled.');
              }
              observation = await ledger.observe(digest);
            }
            if (observation.state === 'confirmed') {
              await confirm(row, observation.proof);
              return true;
            }
            await client.query(
              `
              UPDATE audit_anchors SET attempted_at = clock_timestamp(), attempts = attempts + 1, delivery_failed = false WHERE id = $1
            `,
              [row.id],
            );
            return false;
          });
          if (!finished || next.id === anchorId) break;
        } catch {
          failed = true;
          await commit(async () => {
            const {
              rows: [row],
            } = await client.query(
              'SELECT delivery_failed FROM audit_anchors WHERE id = $1 AND confirmed_at IS NULL FOR UPDATE',
              [next.id],
            );
            if (!row) return;
            await client.query(
              `
              UPDATE audit_anchors SET attempted_at = clock_timestamp(), attempts = attempts + 1, delivery_failed = true WHERE id = $1
            `,
              [next.id],
            );
            if (!row.delivery_failed)
              await appendAudit(client, {
                event: 'audit.timestamp_failed',
                credentialId: failureContext?.credential_id,
                proposalId: failureContext?.proposal_id,
                detail: { anchor_id: next.id },
              });
          });
          break;
        }
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(783120451)');
      } finally {
        client.release();
      }
    }
    if (anchorId && failed) throw new Error('Timestamp delivery unavailable.');
  }
  return deliverAuditAnchors;
}
