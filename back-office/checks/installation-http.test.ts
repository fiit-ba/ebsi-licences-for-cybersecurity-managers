import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { installationStatus, protectedReadProbeTimeoutMs } from './installation-http.ts';

test('installation probes do not reuse connections across service lifecycle checks', async (context) => {
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (sockets.has(request.socket)) {
      request.socket.destroy();
      return;
    }
    sockets.add(request.socket);
    response.end('ready');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  assert.equal(await installationStatus(url), 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await installationStatus(url), 200);
  assert.equal(sockets.size, 2);
});

test('an authenticated KMS refusal is returned once without retrying an HTTP failure', async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.headers.authorization, 'Bearer synthetic-installation-token');
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ reason: 'Unavailable' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  assert.equal(
    await installationStatus(url, { authorization: 'Bearer synthetic-installation-token' }),
    503,
  );
  assert.equal(requests, 1);
});

test('a truncated response fails the probe instead of accepting its status or replaying it', async (context) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-length': '100' });
    response.write('partial');
    setImmediate(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  await assert.rejects(installationStatus(url + '/registry/certificates/'), (error: Error) => {
    assert.equal(error.message, 'Installation HTTP probe failed for /registry/certificates/.');
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
  assert.equal(requests, 1);
});

test(
  'a protected-read probe waits for a KMS refusal beyond the ten-second provider deadline',
  { timeout: 20_000 },
  async (context) => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      setTimeout(() => {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reason: 'FieldEncryptionUnavailable' }));
      }, 10_250);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    assert.equal(await installationStatus(url, undefined, protectedReadProbeTimeoutMs), 503);
    assert.equal(requests, 1);
  },
);
