import { enqueueAfterCommit } from '../background/queue.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';

/** Approved journal event identity and public metadata supplied by a domain transaction. */
export interface AuditEvent {
  event: string;
  actor?: number;
  credentialId?: string | null;
  proposalId?: string | null;
  organizationId?: string;
  detail?: Record<string, unknown>;
}

const fields: Record<string, readonly string[]> = {
  'key.signed': ['key_id', 'key_purpose', 'payload_digest'],
  'ledger.tx_signed': [
    'intent_id',
    'key_id',
    'key_purpose',
    'contract_function',
    'chain_id',
    'payload_digest',
  ],
  'ledger.tx_refused': ['intent_id', 'key_purpose', 'refusal'],
  'governance.proposed': [
    'onchain_proposal_id',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.signed': [
    'onchain_proposal_id',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.executed': [
    'onchain_proposal_id',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.admin_proposed': [
    'admin_proposal_id',
    'admin_change',
    'ti',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.admin_signed': [
    'admin_proposal_id',
    'admin_change',
    'ti',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.admin_executed': [
    'admin_proposal_id',
    'admin_change',
    'ti',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.admin_cancelled': [
    'admin_proposal_id',
    'admin_change',
    'ti',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'governance.admin_expired': [
    'admin_proposal_id',
    'admin_change',
    'ti',
    'signer_role',
    'transaction_hash',
    'governance_contract',
  ],
  'organization.issuer_confirmed': ['did', 'attribute', 'credential_types'],
  'organization.ebsi_published': ['did', 'attribute', 'issuer_type'],
  'organization.governance_configured': ['ti_id', 'contract'],
  'organization.identity_bound': ['did'],
  'key.prepared': ['kid', 'purpose'],
  'key.creation_planned': ['purpose', 'request_id'],
  'key.creation_started': ['purpose', 'request_id'],
  'key.creation_completed': ['purpose', 'request_id', 'kid'],
  'key.activated': ['kid', 'purpose', 'previous_kid'],
  'key.retired': ['kid', 'purpose'],
  // Preserve inspection of immutable entries written before assignment removal.
  'account.created': [
    'account_id',
    'roles',
    'active',
    'issuer_ids',
    'version',
    'staff',
    'superuser',
    'groups',
    'permissions',
  ],
  'account.updated': [
    'account_id',
    'roles',
    'active',
    'issuer_ids',
    'version',
    'staff',
    'superuser',
    'groups',
    'permissions',
  ],
  'account.password_reset': ['account_id'],
  'account.deleted': ['account_id'],
  'group.created': ['group_id', 'permissions'],
  'group.updated': ['group_id', 'permissions', 'version'],
  'group.deleted': ['group_id'],
  'organization.selected': ['schemas'],
  'organization.invited': [],
  'organization.lifespan': ['accredited_until'],
  'organization.grants_removed': ['schema_ids'],
  'organization.accredited': ['schemas'],
  'organization.revoked': ['reason', 'organization_ids'],
  'organization.registered': [],
  'schema.proposed': ['credential_type', 'version'],
  'schema.registered': ['credential_type', 'version'],
  'schema.retired': ['credential_type', 'version'],
  'schema.renamed': ['credential_type', 'version'],
  'certificate.registered': ['credential_type', 'version', 'status_key'],
  'certificate.ledger_registered': ['status_key'],
  'certificate.issued': ['issuer_did', 'organization_id', 'credential_type', 'status_key'],
  'certificate.collected': ['issuer_did', 'credential_type', 'status_key'],
  'offer.created': ['expires_at', 'replacement'],
  'offer.refused': ['reason', 'attempt'],
  'offer.token_issued': [],
  'status.change_proposed': [
    'action',
    'initial_standing',
    'from_state',
    'reason_code',
    'reason_hash',
    'emergency',
  ],
  'status.change_approved': ['action', 'reason_hash'],
  'status.change_rejected': ['action', 'reason_hash'],
  'status.change_withdrawn': ['reason_hash'],
  'status.withdrawal_requested': ['reason_hash'],
  'status.emergency_suspension': [
    'emergency_id',
    'reason_hash',
    'action',
    'from_state',
    'to_state',
    'reason_code',
    'emergency',
  ],
  'status.emergency_confirmed': ['emergency_id', 'chain_id', 'contract', 'reason_hash'],
  'status.change_applied': [
    'from_state',
    'to_state',
    'action',
    'onchain_proposal_id',
    'state',
    'chain_id',
    'contract',
    'reason_hash',
  ],
  'governance.progress': [
    'action',
    'onchain_proposal_id',
    'state',
    'chain_id',
    'contract',
    'reason_hash',
  ],
  'governance.cancelled': [
    'signer_role',
    'transaction_hash',
    'governance_contract',
    'action',
    'onchain_proposal_id',
    'state',
    'chain_id',
    'contract',
    'reason_hash',
  ],
  'governance.expired': [
    'signer_role',
    'transaction_hash',
    'governance_contract',
    'action',
    'onchain_proposal_id',
    'state',
    'chain_id',
    'contract',
    'reason_hash',
  ],
  'governance.delivery_failed': ['withdrawal'],
  'governance.emergency_failed': ['emergency_id'],
  'audit.preimage_disclosed': [],
  'audit.reason_disclosed': [
    'kind',
    'reason_hash',
    'emergency_id',
    'action',
    'onchain_proposal_id',
  ],
  'audit.timestamp_anchored': [
    'anchor_id',
    'entry_id',
    'decision_id',
    'digest',
    'timestamp_id',
    'chain_id',
    'contract',
    'block_number',
    'block_hash',
  ],
  'audit.timestamp_failed': ['anchor_id'],
};

/**
 * Append a privacy-checked event to the immutable journal.
 *
 * @param client - Transaction query executor.
 * @param input - Approved event name, identifiers and allowlisted metadata.
 * @returns The appended sequence ID and prefixed hexadecimal entry hash.
 * @throws Error for unapproved event/detail keys or a missing live actor; serialization and database errors.
 * @remarks Append last in the domain transaction. Never include claims, bearer secrets, PINs or
 * disclosed salts. Pin a live actor before locking the journal head so account
 * deletion cannot race the first protected event. The caller must own a transaction.
 */
export async function appendAudit(client: Pick<PoolClient, 'query'>, input: AuditEvent) {
  const allowed = Object.hasOwn(fields, input.event) && fields[input.event];
  if (!allowed || Object.keys(input.detail ?? {}).some((key) => !allowed.includes(key))) {
    throw new Error('Unknown audit event or unapproved detail fields.');
  }
  if (
    input.actor !== undefined &&
    !(
      await client.query('SELECT id FROM operator_accounts WHERE id=$1 FOR KEY SHARE', [
        input.actor,
      ])
    ).rowCount
  )
    throw new Error('The audit actor no longer exists.');
  const {
    rows: [entry],
  } = await client.query<{ event_id: string; event_hash: Buffer }>(
    `
    SELECT * FROM append_audit_event($1, $2, $3, $4, $5, $6)
  `,
    [
      input.event,
      input.actor ?? null,
      input.credentialId ?? null,
      input.proposalId ?? null,
      input.organizationId ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
  const anchor = (
    await client.query<{ id: string }>('SELECT id FROM audit_anchors WHERE entry_id=$1', [
      entry.event_id,
    ])
  ).rows[0];
  if (anchor) enqueueAfterCommit(client, { operation: 'submit-timestamp', anchorId: anchor.id });
  return { id: entry.event_id, hash: '0x' + entry.event_hash.toString('hex') };
}

/** Stored journal payload, metadata and hash links inspected for integrity. */
interface JournalRow {
  id: string;
  occurred_at: Date;
  event: string;
  actor_id: number | null;
  actor_username: string | null;
  credential_id: string | null;
  proposal_id: string | null;
  organization_id: string | null;
  detail: Record<string, unknown>;
  payload: string;
  previous_hash: Buffer;
  entry_hash: Buffer;
}

/**
 * Hash the exact exported payload and previous link without reserializing JSON.
 *
 * @param previous - Previous 32-byte entry hash.
 * @param payload - Exact stored UTF-8 payload.
 * @returns The domain-separated SHA-256 entry hash.
 */
export function auditHash(previous: Buffer, payload: string) {
  return createHash('sha256')
    .update('ATEST-AUDIT-V1\n')
    .update(previous)
    .update(payload, 'utf8')
    .digest();
}

/**
 * Verify all journal links, payloads and the stored head in bounded batches.
 *
 * @param client - Connection within a stable caller-owned snapshot.
 * @returns Tampering/fork arrays plus verified prefix, head and first-failure diagnostics.
 * @throws Database errors if a query, lock or commit fails.
 * @remarks Use a repeatable-read transaction so journal growth cannot create a false head mismatch.
 */
export async function inspectAudit(client: PoolClient) {
  const {
    rows: [head],
  } = await client.query<{ sequence: string; entry_hash: Buffer }>(
    'SELECT sequence, entry_hash FROM audit_head WHERE singleton',
  );
  let sequence = 0n;
  let previous: Buffer = Buffer.alloc(32);
  let error: string | null = head ? null : 'HeadMissing';
  let brokenAt: string | null = null;
  let cursor = 0n;
  let preceding: Buffer | undefined;
  const known = new Set<string>();
  const altered: (number | string)[] = [];
  const missing: (number | string)[] = [];
  const forks: (number | string)[] = [];
  while (true) {
    const { rows } = await client.query<JournalRow>(
      `
      SELECT * FROM audit_entries WHERE id > $1 ORDER BY id LIMIT 1000
    `,
      [cursor.toString()],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const validTime = row.occurred_at instanceof Date && Number.isFinite(+row.occurred_at);
      const expected = [
        'ATEST-AUDIT-V1',
        row.id,
        validTime ? row.occurred_at.toISOString() : null,
        row.event,
        row.actor_id === null ? null : String(row.actor_id),
        row.actor_username,
        row.credential_id,
        row.proposal_id,
        row.organization_id,
        row.detail,
      ];
      let body;
      let invalidPayload = false;
      try {
        body = JSON.parse(row.payload);
      } catch {
        invalidPayload = true;
      }
      const ownsHash = row.entry_hash.equals(auditHash(row.previous_hash, row.payload));
      const ownsPayload = !invalidPayload && isDeepStrictEqual(body, expected);
      const reference = BigInt(row.id) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(row.id) : row.id;
      if (!validTime || !ownsHash || !ownsPayload) altered.push(reference);
      if (preceding && !row.previous_hash.equals(preceding))
        (known.has(row.previous_hash.toString('hex')) ? forks : missing).push(reference);
      known.add(row.entry_hash.toString('hex'));
      preceding = row.entry_hash;
      cursor = BigInt(row.id);

      if (!error) {
        if (!validTime) error = 'InvalidTimestamp';
        else if (invalidPayload) error = 'InvalidPayload';
        else if (BigInt(row.id) !== sequence + 1n) error = 'SequenceGap';
        else if (!row.previous_hash.equals(previous)) error = 'PreviousHashMismatch';
        else if (!ownsHash) error = 'EntryHashMismatch';
        else if (!ownsPayload) error = 'PayloadMismatch';
        if (error) brokenAt = row.id;
        else {
          sequence = BigInt(row.id);
          previous = row.entry_hash;
        }
      }
    }
  }
  if (!error && (head.sequence !== sequence.toString() || !head.entry_hash.equals(previous)))
    error = 'HeadMismatch';
  const invalidHead =
    !head ||
    head.sequence !== cursor.toString() ||
    !head.entry_hash.equals(preceding ?? Buffer.alloc(32));
  const onlyFork =
    error === 'PreviousHashMismatch' &&
    forks.length > 0 &&
    !altered.length &&
    !missing.length &&
    !invalidHead;
  return {
    intact: error === null,
    tampered: error !== null && !onlyFork,
    altered,
    missing_predecessor: missing,
    forks,
    verified_entries: sequence.toString(),
    head_id: head?.sequence ?? null,
    head_hash: head ? '0x' + head.entry_hash.toString('hex') : null,
    error,
    broken_at: brokenAt,
  };
}
