import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issuerAttributes } from './registry.ts';

test('TIR pagination accepts equivalent DID spelling and refuses foreign, cyclic and malformed collections', async () => {
  const tir = 'https://registry.example/trusted-issuers-registry/v5';
  const did = 'did:ebsi:zTest';
  const literal = `${tir}/issuers/${did}/attributes`;
  const encoded = `${tir}/issuers/${encodeURIComponent(did)}/attributes`;
  const visited: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = String(input);
    visited.push(url);
    if (url.endsWith('/first') || url.endsWith('/second'))
      return Response.json({ did, attribute: { issuerType: 'TI' } });
    const second = url.includes('?page=2');
    return Response.json({
      items: [{ id: second ? 'second' : 'first' }],
      links: { next: literal + '?page=2' },
    });
  };
  assert.deepEqual(
    (await issuerAttributes(tir, did, request)).map((item) => item.id),
    ['first', 'second'],
  );
  assert.deepEqual(visited, [
    encoded,
    encoded + '/first',
    encoded + '?page=2',
    encoded + '/second',
  ]);
  for (const next of [
    'https://attacker.example/attributes',
    literal + '/other',
    literal + '?page=1',
  ]) {
    let calls = 0;
    await assert.rejects(
      issuerAttributes(tir, did, async () => {
        calls++;
        return Response.json({
          items: [],
          links: { next: calls % 2 === 0 ? literal + '?page=2' : next },
        });
      }),
    );
  }
  await assert.rejects(issuerAttributes(tir, did, async () => Response.json({ items: [{}] })));
  assert.deepEqual(
    await issuerAttributes(tir, did, async () => new Response(null, { status: 404 })),
    [],
  );
});
