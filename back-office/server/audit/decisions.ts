import { enqueueAfterCommit } from '../background/queue.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Protection } from '../issuance/protection.ts';
import { transaction } from '../adapters/transaction.ts';
import { authorizeAuditor } from './service.ts';
import type { TimestampLedger } from './timestamp-ledger.ts';

/**
 * Serialize a decision with sorted object keys and escaped non-ASCII characters.
 * @param value - JSON-compatible decision data; Date values use the canonical UTC text form.
 * @returns Canonical JSON without insignificant whitespace.
 * @throws Serialization errors for unsupported/cyclic decision data.
 */
export function canonicalDecision(value: unknown): string {
  /**
   * Normalize private snapshot values using the canonical UTC datetime representation.
   * @param item - Current JSON-compatible value.
   * @returns Sorted objects, normalized dates and recursively normalized arrays.
   */
  const normalize = (item: unknown): unknown => {
    if (item instanceof Date)
      return item
        .toISOString()
        .replace('T', ' ')
        .replace(/\.(\d{3})Z$/, (_, milliseconds: string) =>
          milliseconds === '000' ? '+00:00' : '.' + milliseconds + '000+00:00',
        );
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => compareKeys(a, b))
          .map(([key, value]) => [key, normalize(value)]),
      );
    return item;
  };
  return JSON.stringify(normalize(value)).replace(
    /[\u007f-\uffff]/g,
    (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * Sort keys by Unicode code point rather than UTF-16 surrogate units.
 * @param left - First object key.
 * @param right - Second object key.
 * @returns Negative, zero or positive lexical comparison.
 */
function compareKeys(left: string, right: string) {
  const a = Array.from(left),
    b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

/**
 * Hash exactly the private-decision envelope, separately from the journal chain.
 * @param decision - JSON decision snapshot.
 * @returns The unprefixed SHA-256 digest.
 * @throws Serialization errors.
 */
export function decisionDigest(decision: unknown) {
  return createHash('sha256')
    .update('PLR-DECISION-V1|' + canonicalDecision(decision))
    .digest('hex');
}

/**
 * Store a decision snapshot and durable timestamp work within its domain transaction.
 * @param client - Caller-owned domain transaction connection.
 * @param protection - Existing installation encryption key, bound to the decision UUID.
 * @param input - Kind, certificate/case references and complete private decision fields.
 * @returns Idempotently stored decision-anchor UUID.
 * @throws Serialization, encryption or database errors; no external dependency is contacted.
 */
export async function anchorDecision(
  client: PoolClient,
  protection: Protection,
  input: {
    kind: string;
    certificate: string;
    credentialId: string;
    proposal?: string;
    decision: Record<string, unknown>;
  },
) {
  const snapshot = JSON.parse(canonicalDecision({ kind: input.kind, ...input.decision }));
  const digest = Buffer.from(decisionDigest(snapshot), 'hex');
  const id = randomUUID();
  await client.query(
    `INSERT INTO decision_anchors(id,digest,certificate_id,credential_id,proposal_id,kind,decision_encrypted)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(digest) DO NOTHING`,
    [
      id,
      digest,
      input.certificate,
      input.credentialId,
      input.proposal ?? null,
      input.kind,
      await protection.seal(id, snapshot),
    ],
  );
  const stored = (await client.query('SELECT id FROM decision_anchors WHERE digest=$1', [digest]))
    .rows[0];
  await client.query(
    'INSERT INTO audit_anchors(decision_id,digest) VALUES($1,$2) ON CONFLICT(decision_id) DO NOTHING',
    [stored.id, digest],
  );
  const anchor = (
    await client.query('SELECT id FROM audit_anchors WHERE decision_id=$1', [stored.id])
  ).rows[0];
  enqueueAfterCommit(client, { operation: 'submit-timestamp', anchorId: anchor.id });
  return stored.id as string;
}

/**
 * Read decision evidence without disclosing the private decision snapshot.
 * @param database - PostgreSQL pool.
 * @param protection - Installation key for independently recomputing the private decision digest.
 * @param ledger - Optional dedicated timestamp evidence reader.
 * @returns Auditor-only kind/digest/transaction evidence, oldest first.
 */
export function postgresDecisionAnchors(
  database: Pool,
  protection: Protection | undefined,
  ledger?: TimestampLedger,
) {
  /**
   * Recompute each digest and independently read its exact timestamp record.
   * @param actor - Current auditor account ID.
   * @param query - Existing credential_id, accepting provisional and collected IDs.
   * @returns Anchor results; unavailable/mismatched evidence is never reported as anchored.
   * @throws Authorization or database errors; decryption/provider failures produce unverified evidence.
   */
  return async function list(actor: number, query: URLSearchParams) {
    const rows = await transaction(database, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await authorizeAuditor(client, actor);
      return (
        await client.query(
          `SELECT d.*,q.chain_id,q.contract,q.signer_address FROM decision_anchors d
        JOIN audit_anchors q ON q.decision_id=d.id WHERE d.certificate_id IN (
          SELECT id FROM registered_certificates WHERE credential_id=$1 OR registered_id=$1)
        ORDER BY d.created_at,d.id`,
          [query.get('credential_id')],
        )
      ).rows;
    });
    const results = [];
    for (const row of rows) {
      const digest = row.digest.toString('hex');
      let matches = false;
      try {
        matches =
          Boolean(protection) &&
          decisionDigest(protection!.open(row.id, row.decision_encrypted)) === digest;
      } catch {
        /* Unavailable/corrupt private evidence is not verified. */
      }
      let anchored = false;
      let timestamp: string | null = null;
      if (ledger && Number(row.chain_id) === ledger.chainId && row.contract === ledger.contract) {
        try {
          const observed = await ledger.observe('0x' + digest);
          if (observed.state === 'confirmed' && row.signer_address === ledger.signerAddress) {
            anchored = true;
            timestamp = observed.proof.timestamp;
          }
        } catch {
          /* Keep dependency failure separate from a valid timestamp. */
        }
      }
      results.push({
        kind: row.kind,
        created_at: row.created_at,
        anchored_at: row.anchored_at,
        digest,
        digest_matches: matches,
        anchored,
        timestamp,
        transaction_hash: row.transaction_hash,
      });
    }
    return { results };
  };
}
