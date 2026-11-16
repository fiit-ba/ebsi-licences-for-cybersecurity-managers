import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { backOfficeServer } from './app.ts';
import { loadConsoleAssets } from './console.ts';
import type { OperatorAccount } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';

test('console serves only built assets and known pages with a strict CSP', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'atest-console-assets-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Atest</title>');
  await writeFile(join(directory, 'assets/main-ABCDEFGH.js'), 'export const application = true;');
  await writeFile(join(directory, 'assets/licenses.txt'), 'Third-party notices');
  const account: OperatorAccount = {
    id: 1,
    username: 'viewer',
    email: 'viewer@example.test',
    first_name: '',
    last_name: '',
    password_hash: '',
    active: true,
    auth_version: 1,
    roles: ['plr_verifier'],
    organization_name: null,
    organization_kind: null,
    organization_did: null,
    accredited_until: null,
    accreditation_ended: false,
    revoked_name: null,
    revoked_kind: null,
    revoked_at: null,
  };
  const server = backOfficeServer({
    accounts: { byId: async () => account, byUsername: async () => account },
    tokens: { ...operatorTokens('console-test-secret-'.repeat(2)), accountId: async () => 1 },
    consoleAssets: await loadConsoleAssets(pathToFileURL(directory + '/')),
  });
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  for (const path of [
    '/console/',
    '/console/login',
    '/console/audit',
    '/',
    '/issue',
    '/lifecycle',
    '/verify',
    '/governance',
    '/schemas',
    '/accreditation',
    '/audit',
    '/password_reset/',
    '/password_reset/complete',
    '/admin/auth/user/',
    '/admin/auth/user/add/',
    '/admin/auth/user/42/change/',
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), '<!doctype html><title>Atest</title>');
  }
  const script = await fetch(origin + '/console/assets/main-ABCDEFGH.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(script.headers.get('cache-control'), /immutable/);
  const head = await fetch(origin + '/console/login', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of [
    '/console/private',
    '/reset/MQ/dh8a0w-ad786e26b0e5e032efa75787aef3b85b/',
    '/password_reset/abcdef012345',
    '/console/%2e%2e/server/http/start.ts',
    '/registry/missing/',
    '/registry/schemas/',
    '/registry/schema-names/',
    '/registry/certificate-scheme/',
    '/registry/trust-chain/',
    '/console/assets/unknown.js',
  ]) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  const config = await fetch(origin + '/console/config.json');
  assert.deepEqual(await config.json(), { registration_available: false });
  const profile = await fetch(origin + '/registry/me/', {
    headers: { authorization: 'Bearer valid' },
  });
  assert.equal(
    Object.values((await profile.json()).capabilities).every((value) => value === false),
    true,
  );
  await symlink(join(directory, 'index.html'), join(directory, 'assets/linked.js'));
  await assert.rejects(
    loadConsoleAssets(pathToFileURL(directory + '/')),
    /Console assets are unavailable/,
  );
});
