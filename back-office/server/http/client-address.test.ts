import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { test } from 'node:test';
import { clientAddress } from './client-address.ts';

test('untrusted forwarding headers cannot choose a recovery rate-limit identity', () => {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  const request = new IncomingMessage(socket);
  request.headers['x-forwarded-for'] = '198.51.100.12';
  assert.equal(clientAddress(request), '127.0.0.1');
  request.headers['x-forwarded-for'] = '198.51.100.12, 10.0.0.2';
  assert.equal(clientAddress(request, 2), '198.51.100.12');
  request.headers['x-forwarded-for'] = 'garbage, 10.0.0.2';
  assert.equal(clientAddress(request, 2), '127.0.0.1');
  request.headers['x-forwarded-for'] = '198.51.100.12';
  assert.equal(clientAddress(request, 2), '127.0.0.1');
  request.headers['x-forwarded-for'] = '2001:0db8:0:0:0:0:0:1, 10.0.0.2';
  assert.equal(clientAddress(request, 2), '2001:db8::1');
  assert.throws(() => clientAddress(request, -1), /trusted proxy/);
  socket.destroy();
});
