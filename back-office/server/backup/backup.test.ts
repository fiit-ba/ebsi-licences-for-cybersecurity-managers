import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { backupApi, backupHolder } from './fixtures/api.ts';
import { backupCases } from './fixtures/cases.ts';
import { backupDigest, versionJson } from './proof.ts';

test('backup protocol scenarios and additional proof/deletion refusals over real HTTP', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  for (const item of backupCases()) {
    const result = await api.call(item.id, item.method, item.body);
    assert.equal(result.status, item.status, item.name + ': ' + JSON.stringify(result.body));
    if (item.reason) assert.equal(result.body.reason, item.reason, item.name);
    if (item.name === 'read ciphertext') assert.equal(result.body.ciphertext, 'Y2lwaGVy');
    if (item.reason === 'StaleVersion') assert.equal(result.body.version, 2);
  }
});

test('original opaque model, privacy and verified-key injection safety', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  const h = backupHolder();
  const body = h.upload('YQ', 1, {
    key: { ...h.jwk, d: 'private-payload', did: 'did:secret' },
    holder: 'did:secret',
  });
  assert.equal(
    (await api.call(h.id, 'PUT', body, { authorization: 'Bearer invalid-operator-token' })).status,
    200,
  );
  const row = (
    await api.database.query('SELECT * FROM plr_walletbackup WHERE backup_id=$1', [h.id])
  ).rows[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    ['backup_id', 'public_key', 'ciphertext', 'version', 'created_at', 'updated_at'].sort(),
  );
  assert.deepEqual(row.public_key, h.jwk);
  assert.equal(JSON.stringify(row).includes('did:'), false);
  const read = await api.call(h.id);
  assert.deepEqual(Object.keys(read.body).sort(), ['ciphertext', 'updated_at', 'version']);
  await api.database.query(
    "UPDATE plr_walletbackup SET updated_at='2026-01-01T00:00:00Z' WHERE backup_id=$1",
    [h.id],
  );
  assert.equal((await api.call(h.id)).body.updated_at, '2026-01-01T00:00:00Z');
  assert.equal(api.errors.length, 0);
});

test('ciphertext and envelope bounds; declared and chunked oversized requests; normal body limit bypass', async (t) => {
  const api = await backupApi({ maxBytes: 8 });
  const large = await backupApi();
  t.after(() => api.close());
  t.after(() => large.close());
  const h = backupHolder();
  assert.equal((await api.call(h.id, 'PUT', h.upload('Q'.repeat(8)))).status, 200);
  for (const size of [9, 128 * 1024]) {
    const response = await api.call(h.id, 'PUT', h.upload('Q'.repeat(size), 2));
    assert.equal(response.status, 413);
    assert.deepEqual(response.body, {
      detail: 'A backup holds at most 8 bytes',
      reason: 'TooLarge',
    });
  }
  const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(
      `${api.origin}/wallet-backups/${h.id}/`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.write(' '.repeat(64 * 1024 + 9));
    req.end('{not JSON');
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.reason, 'TooLarge');
  const big = 'Q'.repeat(3 * 1024 * 1024);
  assert.equal((await large.call(h.id, 'PUT', h.upload(big, 2))).status, 200);
  assert.equal((await large.call(h.id)).body.ciphertext.length, big.length);
  assert.equal((await api.call(h.id, 'PUT', '{bad')).body.detail, 'The upload is not JSON');
  assert.equal((await api.call(h.id, 'PUT', 'a', { 'content-type': 'text/plain' })).status, 415);
});

test('versions preserve PostgreSQL bigint precision and maximum range', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  const h = backupHolder();
  // Sign exact JSON integer text, rather than rounding through JavaScript Number.
  const { sign } = await import('node:crypto');
  for (const version of [9007199254740993n, 9223372036854775807n]) {
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: 'plr-wallet-backup+jwt', jwk: h.jwk }),
    ).toString('base64url');
    const claims = JSON.stringify({
      backup: h.id,
      iat: Math.floor(Date.now() / 1000),
      version: versionJson(version),
      digest: backupDigest('YQ'),
    });
    const input = header + '.' + Buffer.from(claims).toString('base64url');
    const proof =
      input +
      '.' +
      sign('sha256', Buffer.from(input), { key: h.privateKey, dsaEncoding: 'ieee-p1363' }).toString(
        'base64url',
      );
    const body = JSON.stringify({ ciphertext: 'YQ', version: versionJson(version), proof });
    const response = await fetch(`${api.origin}/wallet-backups/${h.id}/`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(`"version":${version}`));
    assert.equal((await api.call(h.id, 'PUT', body)).status, 409);
  }
});

test('existing-row concurrent writes are monotonic and DELETE waits for its row lock', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  const h = backupHolder();
  await api.call(h.id, 'PUT', h.upload());
  const outcomes = await Promise.all(
    Array.from({ length: 12 }, (_, i) => api.call(h.id, 'PUT', h.upload('YQ', i + 2))),
  );
  assert.ok(outcomes.every((r) => [200, 409].includes(r.status)));
  assert.equal((await api.call(h.id)).body.version, 13);
  const lock = await api.database.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT 1 FROM plr_walletbackup WHERE backup_id=$1 FOR UPDATE', [h.id]);
    const pending = api.call(h.id, 'DELETE', { proof: h.proof({ delete: true }) });
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const { rows } = await api.database.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT public_key FROM plr_walletbackup%'",
      );
      if (rows.length) {
        observed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(observed, 'DELETE must wait on the actual database row lock');
    await lock.query('COMMIT');
    assert.equal((await pending).status, 204);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
});

test('weighted windows count all methods atomically per trusted address and do not count refusals', async (t) => {
  let now = 6000;
  const api = await backupApi({ rate: '3/min', clock: () => now, hops: 1 });
  t.after(() => api.close());
  const h = backupHolder();
  const headers = { 'x-forwarded-for': '192.0.2.21' };
  const outcomes = await Promise.all(
    Array.from({ length: 12 }, () => api.call(h.id, 'GET', undefined, headers)),
  );
  assert.equal(outcomes.filter((r) => r.status === 404).length, 3);
  assert.equal(outcomes.filter((r) => r.status === 429).length, 9);
  assert.equal(outcomes.find((r) => r.status === 429)!.headers.get('retry-after'), '60');
  assert.equal(
    (await api.call(h.id, 'GET', undefined, { 'x-forwarded-for': '192.0.2.22' })).status,
    404,
  );
  now = 6060;
  assert.equal((await api.call(h.id, 'GET', undefined, headers)).status, 429);
  now = 6090;
  assert.equal((await api.call(h.id, 'GET', undefined, headers)).status, 404);
  assert.equal((await api.call(h.id, 'GET', undefined, headers)).status, 429);
  const mixed = { 'x-forwarded-for': '192.0.2.23' };
  assert.equal((await api.call(h.id, 'PUT', '{bad JSON', mixed)).status, 400);
  assert.equal((await api.call(h.id, 'DELETE', {}, mixed)).status, 404);
  assert.equal((await api.call(h.id, 'GET', undefined, mixed)).status, 404);
  assert.equal((await api.call(h.id, 'GET', undefined, mixed)).status, 429);

  const direct = await backupApi({ rate: '3/min', clock: () => 120000 });
  t.after(() => direct.close());
  const spoofed = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      direct.call(h.id, 'GET', undefined, { 'x-forwarded-for': `198.51.100.${i + 1}` }),
    ),
  );
  assert.equal(spoofed.filter((result) => result.status === 404).length, 3);
  assert.equal(spoofed.filter((result) => result.status === 429).length, 1);

  const buckets = (await api.database.query('SELECT bucket FROM wallet_backup_limits')).rows;
  assert.ok(buckets.every((r) => r.bucket.length === 32));
});

test('simultaneous first PUT handles simultaneous first inserts without inventing an upsert policy', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  const h = backupHolder();
  const lock = await api.database.connect();
  await api.database
    .query(`CREATE FUNCTION backup_test_insert_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.backup_id=TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(987654301); END IF;
      RETURN NEW;
    END $$`);
  await api.database
    .query(`CREATE TRIGGER backup_test_insert_barrier BEFORE INSERT ON plr_walletbackup
    FOR EACH ROW EXECUTE FUNCTION backup_test_insert_barrier('${h.id}')`);
  let pending: Promise<any[]> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(987654301)');
    pending = Promise.all([
      api.call(h.id, 'PUT', h.upload('YQ', 1)),
      api.call(h.id, 'PUT', h.upload('Yg', 2)),
    ]);
    let waiting = 0;
    for (let i = 0; i < 100; i++) {
      const result = await api.database
        .query(`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event='advisory' AND query LIKE 'INSERT INTO plr_walletbackup%'`);
      waiting = result.rows[0].count;
      if (waiting === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, 2, 'Both real transactions observed no existing row before INSERT');
    await lock.query('COMMIT');
    const responses = await pending;
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 500]);
    assert.equal((api.errors[0] as { code?: string }).code, '23505');
    assert.equal(
      (
        await api.database.query(
          'SELECT count(*)::integer AS count FROM plr_walletbackup WHERE backup_id=$1',
          [h.id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await pending;
    await api.database.query('DROP TRIGGER backup_test_insert_barrier ON plr_walletbackup');
    await api.database.query('DROP FUNCTION backup_test_insert_barrier()');
  }
});
