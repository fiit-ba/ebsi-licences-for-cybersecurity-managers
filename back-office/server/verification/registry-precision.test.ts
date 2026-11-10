import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verificationRegistry } from './registry.ts';

test('historical issuer lookup retains subsecond issuance after a fresh KMS key activation', async () => {
  const did = 'did:ebsi:zPrecision';
  const kid = did + '#assertion';
  const at = '2026-11-04T10:00:00.750Z';
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  const token = await new SignJWT({ vc: { issuer: did, issuanceDate: at } })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(did)
    .sign(pair.privateKey);
  const observed: string[] = [];
  const registry = verificationRegistry({
    didr: 'https://registry.example/didr',
    tir: 'https://registry.example/tir',
    tsr: 'https://registry.example/tsr',
    roots: ['did:ebsi:zSupport'],
    async fetchRegistry(input) {
      const requested = new URL(String(input)).searchParams.get('valid-at')!;
      observed.push(requested);
      const active = Date.parse(requested) >= Date.parse('2026-11-04T10:00:00.500Z');
      return Response.json({
        id: did,
        verificationMethod: active ? [{ id: kid, controller: did, publicKeyJwk: jwk }] : [],
        assertionMethod: active ? [kid] : [],
      });
    },
  });
  assert.equal((await registry.signed(token)).issuer, did);
  assert.deepEqual(observed, [at]);
});
