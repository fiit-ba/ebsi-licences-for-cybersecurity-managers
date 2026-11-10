import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { appendAudit, inspectAudit, auditHash } from './journal.ts';
import { transaction } from '../adapters/transaction.ts';
import type { PoolClient } from 'pg';

test('audit journal serializes concurrent writers, rolls back atomically and detects damaged history', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool({ max: 8 });
  const reference = 'urn:audit-test:' + randomUUID();
  let accountId: number | undefined;
  context.after(async () => {
    try {
      if (accountId)
        await database.query('DELETE FROM operator_accounts WHERE id = $1', [accountId]);
    } finally {
      await database.end();
    }
  });
  await Promise.all(
    Array.from({ length: 24 }, () =>
      transaction(database, (client: PoolClient) =>
        appendAudit(client, { event: 'audit.preimage_disclosed', credentialId: reference }),
      ),
    ),
  );

  const { rows: events } = await database.query(
    `
    SELECT * FROM audit_entries WHERE credential_id = $1 ORDER BY id
  `,
    [reference],
  );
  assert.equal(events.length, 24);
  for (const event of events) {
    // Independently reproduce the database's exported-byte proof in Node.
    const proof = createHash('sha256')
      .update(Buffer.from('ATEST-AUDIT-V1\n', 'ascii'))
      .update(event.previous_hash)
      .update(Buffer.from(event.payload, 'utf8'))
      .digest();
    assert.deepEqual(event.entry_hash, proof);
    const payload = JSON.parse(event.payload);
    assert.equal(payload[1], event.id);
    assert.equal(payload[2], event.occurred_at.toISOString());
    assert.equal(payload[6], reference);
  }
  const rolledBackReference = reference + ':rollback';
  const {
    rows: [account],
  } = await database.query(
    `
    INSERT INTO operator_accounts (username, password_hash) VALUES ($1, 'no-login') RETURNING id
  `,
    ['audit-rollback-' + randomUUID()],
  );
  accountId = account.id;
  await assert.rejects(
    transaction(database, async (client: PoolClient) => {
      await client.query(
        "UPDATE operator_accounts SET email = 'not-committed@example.test' WHERE id = $1",
        [account.id],
      );
      await appendAudit(client, {
        event: 'audit.preimage_disclosed',
        actor: account.id,
        credentialId: rolledBackReference,
      });
      throw new Error('Domain transaction failed');
    }),
    /Domain transaction failed/,
  );
  assert.equal(
    (await database.query('SELECT email FROM operator_accounts WHERE id = $1', [account.id]))
      .rows[0].email,
    '',
  );
  assert.equal(
    (
      await database.query('SELECT 1 FROM audit_entries WHERE credential_id = $1', [
        rolledBackReference,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    transaction(database, async (client: PoolClient) => {
      await client.query(
        "UPDATE operator_accounts SET email = 'not-committed@example.test' WHERE id = $1",
        [account.id],
      );
      await client.query(
        "SELECT * FROM append_audit_event('invalid event',$1,NULL,NULL,NULL,'{}')",
        [account.id],
      );
    }),
    /check constraint/,
  );
  assert.equal(
    (await database.query('SELECT email FROM operator_accounts WHERE id = $1', [account.id]))
      .rows[0].email,
    '',
  );
  await assert.rejects(
    transaction(database, (client: PoolClient) =>
      appendAudit(client, {
        event: 'audit.preimage_disclosed',
        detail: { salt: 'must-not-be-logged' },
      }),
    ),
    /unapproved detail fields/,
  );

  await transaction(database, (client: PoolClient) =>
    appendAudit(client, {
      event: 'audit.preimage_disclosed',
      actor: account.id,
      credentialId: reference,
    }),
  );
  const username = (
    await database.query('SELECT username FROM operator_accounts WHERE id = $1', [account.id])
  ).rows[0].username;
  await database.query('DELETE FROM operator_accounts WHERE id = $1', [account.id]);
  assert.equal(
    (
      await database.query(
        `
    SELECT actor_username FROM audit_entries WHERE credential_id = $1 AND actor_id = $2
  `,
        [reference, account.id],
      )
    ).rows[0].actor_username,
    username,
  );

  await context.test('ordinary SQL cannot update, delete or truncate journal entries', async () => {
    for (const sql of [
      'UPDATE audit_entries SET detail = detail WHERE false',
      'DELETE FROM audit_entries WHERE false',
      'TRUNCATE audit_entries CASCADE',
    ]) {
      await assert.rejects(
        database.query(sql),
        /Audit entries are immutable|Audit anchors cannot be removed/,
      );
    }
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE pg_read_all_data');
      await assert.rejects(
        client.query(
          "SELECT * FROM append_audit_event('audit.forbidden',NULL,NULL,NULL,NULL,'{}')",
        ),
        /permission denied/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  await context.test('a broken head prevents a new domain transaction from appending', async () => {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE audit_head SET entry_hash = decode(repeat('11',32),'hex')");
      await assert.rejects(
        appendAudit(client, { event: 'audit.preimage_disclosed' }),
        /head does not match/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  await context.test(
    'inspection spans batches and remains consistent during a concurrent commit',
    async () => {
      await database.query(
        `
      SELECT event_id FROM generate_series(1,1005) item
      CROSS JOIN LATERAL append_audit_event('audit.batch_test',NULL,$1,NULL,NULL,jsonb_build_object('item',item))
    `,
        [reference],
      );
      await transaction(database, async (client: PoolClient) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const first = await inspectAudit(client);
        assert.equal(first.intact, true);
        assert.ok(BigInt(first.verified_entries) > 1000n);
        await transaction(database, (other: PoolClient) =>
          appendAudit(other, { event: 'audit.preimage_disclosed', credentialId: reference }),
        );
        assert.deepEqual(await inspectAudit(client), first);
      });
    },
  );

  await context.test(
    'inspection detects tampering and tail loss using disposable copies',
    async () => {
      // Damage only temporary tables. Other tests continue using public history.
      const cases = [
        ["UPDATE audit_entries SET payload = 'invalid' WHERE id = 1", 'InvalidPayload'],
        ["UPDATE audit_entries SET detail = '{}' WHERE id = 1", 'PayloadMismatch'],
        [
          "UPDATE audit_entries SET entry_hash = decode(repeat('11',32),'hex') WHERE id = 1",
          'EntryHashMismatch',
        ],
        [
          "UPDATE audit_entries SET previous_hash = decode(repeat('11',32),'hex') WHERE id = 1",
          'PreviousHashMismatch',
        ],
        ['DELETE FROM audit_entries WHERE id = 1', 'SequenceGap'],
        [
          'DELETE FROM audit_entries WHERE id = (SELECT max(id) FROM audit_entries)',
          'HeadMismatch',
        ],
        ["UPDATE audit_head SET entry_hash = decode(repeat('11',32),'hex')", 'HeadMismatch'],
        ["UPDATE audit_entries SET occurred_at = 'infinity' WHERE id = 1", 'InvalidTimestamp'],
        ['DELETE FROM audit_head', 'HeadMissing'],
      ];
      for (const [damage, reason] of cases) {
        const client = await database.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          await client.query(
            'CREATE TEMP TABLE audit_head ON COMMIT DROP AS SELECT * FROM public.audit_head',
          );
          await client.query(
            'CREATE TEMP TABLE audit_entries ON COMMIT DROP AS SELECT * FROM public.audit_entries',
          );
          assert.equal((await inspectAudit(client)).intact, true);
          await client.query(damage);
          const result = await inspectAudit(client);
          assert.equal(result.intact, false, damage);
          assert.equal(result.error, reason, damage);
          assert.equal(result.tampered, true, damage);
          assert.ok(Array.isArray(result.altered));
          assert.ok(Array.isArray(result.missing_predecessor));
          assert.ok(Array.isArray(result.forks));
          if (reason === 'PayloadMismatch') assert.ok(result.altered.includes(1));
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    },
  );
  await context.test(
    'audit chain projection distinguishes a valid-content fork from tampering',
    async () => {
      const client = await database.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await client.query(
          'CREATE TEMP TABLE audit_head ON COMMIT DROP AS SELECT * FROM public.audit_head',
        );
        await client.query(
          'CREATE TEMP TABLE audit_entries ON COMMIT DROP AS SELECT * FROM public.audit_entries',
        );
        const intact = await inspectAudit(client);
        assert.equal(intact.tampered, false);
        assert.deepEqual(intact.altered, []);
        assert.deepEqual(intact.missing_predecessor, []);
        assert.deepEqual(intact.forks, []);
        const row = (
          await client.query('SELECT id,payload FROM audit_entries ORDER BY id DESC LIMIT 1')
        ).rows[0];
        const predecessor = (
          await client.query(
            'SELECT entry_hash FROM audit_entries WHERE id<$1 ORDER BY id DESC OFFSET 1 LIMIT 1',
            [row.id],
          )
        ).rows[0].entry_hash;
        const hash = auditHash(predecessor, row.payload);
        await client.query('UPDATE audit_entries SET previous_hash=$2,entry_hash=$3 WHERE id=$1', [
          row.id,
          predecessor,
          hash,
        ]);
        await client.query('UPDATE audit_head SET entry_hash=$1', [hash]);
        const fork = await inspectAudit(client);
        assert.equal(fork.intact, false);
        assert.equal(fork.tampered, false);
        assert.deepEqual(fork.altered, []);
        assert.deepEqual(fork.missing_predecessor, []);
        assert.deepEqual(fork.forks, [Number(row.id)]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    },
  );
});
