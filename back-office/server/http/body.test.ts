import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { jsonBody } from './body.ts';

/**
 * A JSON request carrying `text` as its body.
 * @param text - The raw body.
 * @returns A request-shaped stream.
 */
function request(text: string) {
  const stream = Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

test('a NUL character anywhere in a JSON body is refused before any query sees it', async () => {
  for (const text of [
    '{"username":"ali\\u0000ce","password":"x"}',
    '{"claims":{"holderName":"J\\u0000N"}}',
    '{"schemas":["A","B\\u0000"]}',
    '{"bad\\u0000key":1}',
  ])
    assert.deepEqual(await jsonBody(request(text)), {
      status: 400,
      body: { detail: 'Null characters are not allowed.' },
    });
});

test('an unpaired surrogate is refused; a paired one (an emoji) is not', async () => {
  for (const text of ['{"name":"Org \\ud800"}', '{"name":"\\udfff Org"}', '{"\\ud800":1}'])
    assert.deepEqual(await jsonBody(request(text)), {
      status: 400,
      body: { detail: 'Unpaired surrogate characters are not allowed.' },
    });
  assert.deepEqual(await jsonBody(request('{"name":"Org \\ud83d\\udee1"}')), {
    status: undefined,
    body: { name: 'Org 🛡' },
  });
});

test('bidirectional controls are refused, so a name cannot reorder the text after it', async () => {
  for (const control of ['202a', '202b', '202c', '202d', '202e', '2066', '2067', '2068', '2069'])
    assert.deepEqual(await jsonBody(request(`{"name":"Org \\u${control} test"}`)), {
      status: 400,
      body: { detail: 'Bidirectional control characters are not allowed.' },
    });
  // Right-to-left text itself, and the plain direction marks, are ordinary text.
  assert.deepEqual(await jsonBody(request('{"name":"مركز \\u200f test"}')), {
    status: undefined,
    body: { name: 'مركز ‏ test' },
  });
});

test('the text \\u0000 itself, an escaped backslash, is not a NUL character', async () => {
  assert.deepEqual(await jsonBody(request('{"note":"\\\\u0000"}')), {
    status: undefined,
    body: { note: '\\u0000' },
  });
});
