import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { backupHolder } from './fixtures/api.ts';

test('ordinary npm start runtime always serves signed backup independently of issuance and operator login', async () => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const admin = new pg.Client();
  await admin.connect();
  const name = `atest_backup_runtime_${process.pid}`;
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const env = {
      ...process.env,
      PGDATABASE: name,
      HOST: '127.0.0.1',
      PORT: String(port),
      BACK_OFFICE_TOKEN_SECRET: 'runtime-backup-only-test-secret-value',
      BACK_OFFICE_CONSOLE_ENABLED: 'false',
      BACK_OFFICE_ISSUANCE_ENABLED: 'false',
      BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED: 'false',
      BACK_OFFICE_PASSWORD_RECOVERY_ENABLED: 'false',
      BACK_OFFICE_TIMESTAMP_ENABLED: 'false',
      PLR_WALLET_BACKUP_RATE: '30/min',
    };
    execFileSync(process.execPath, ['data/migrate.ts'], { cwd, env, stdio: 'pipe' });
    child = spawn(process.execPath, ['server/http/start.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stderr!.on('data', (chunk) => (diagnostics += chunk));
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(diagnostics);
      try {
        ready = (await fetch(origin + '/health/ready')).status === 200;
      } catch {
        /* Listener starting. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, diagnostics);
    const h = backupHolder();
    const url = `${origin}/wallet-backups/${h.id}/`;
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' },
      body: JSON.stringify(h.upload()),
    });
    assert.equal(put.status, 200, await put.text());
    assert.equal((await (await fetch(url)).json()).ciphertext, 'c2VjcmV0');
    const removed = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof: h.proof({ delete: true }) }),
    });
    assert.equal(removed.status, 204);
    assert.equal((await fetch(url)).status, 404);
  } finally {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
