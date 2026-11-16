import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { didRegistry } from '../ebsi/did-registry.ts';
import { certificateFinalizer } from '../issuance/finalizer.ts';
import { credentialHash, issuanceProtection } from '../issuance/protection.ts';
import { credentialVerifier } from './credential.ts';

test('DID resolution pins origin, instance, issuance time, relationship and exact public material', async () => {
  const did = 'did:ebsi:zHistory';
  const kid = did + '#original';
  const old = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  const replacement = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  const method = (key: typeof old) => ({
    id: kid,
    type: 'JsonWebKey2020',
    controller: did,
    publicKeyJwk: key,
  });
  const original = { id: did, verificationMethod: [method(old)], assertionMethod: [kid] };
  const current = { id: did, verificationMethod: [method(replacement)], assertionMethod: [] };
  const at = new Date('2026-06-01T10:00:00Z');
  let response = original;
  let missing = false;
  let calls = 0;
  const registry = didRegistry({
    identifiersUrl: 'https://example.test/v1/did-registry/identifiers',
    contractAddress: '0x' + 'ab'.repeat(20),
    async fetchRegistry(input, init) {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://example.test');
      assert.equal(url.pathname, '/v1/did-registry/identifiers/' + did);
      assert.equal(url.searchParams.get('contractAddress'), '0x' + 'ab'.repeat(20));
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      if (missing) return new Response(null, { status: 404 });
      return Response.json(
        url.searchParams.get('valid-at') === at.toISOString() ? response : current,
      );
    },
  });
  assert.equal((await registry.key(did, kid, 'assertionMethod', at)).x, old.x);
  await assert.rejects(registry.key(did, kid, 'assertionMethod'), /relationship/);
  response = { ...original, verificationMethod: [method({ ...old, d: 'secret' })] };
  await assert.rejects(registry.key(did, kid, 'assertionMethod', at), /Invalid public/);
  response = { ...original, verificationMethod: [method(old), method(replacement)] };
  await assert.rejects(registry.key(did, kid, 'assertionMethod', at), /ambiguous/);
  response = {
    ...original,
    verificationMethod: [{ ...method(old), controller: 'did:ebsi:zOther' }],
  };
  await assert.rejects(registry.key(did, kid, 'assertionMethod', at), /invalid/);
  response = original;
  await assert.rejects(registry.key(did, kid, 'authentication', at), /relationship/);
  missing = true;
  const before = calls;
  await assert.rejects(registry.key(did, kid, 'assertionMethod', at), /version is unavailable/);
  assert.equal(calls, before + 1, 'Historical failure must not fall back to the current document.');
  await assert.rejects(registry.key(did, kid, 'assertionMethod', new Date('invalid')), /timestamp/);
  const large = didRegistry({
    identifiersUrl: 'https://example.test/identifiers',
    fetchRegistry: async () => new Response('x'.repeat(256 * 1024 + 1)),
  });
  await assert.rejects(large.document(did), /too large/);
});

test('a signed certificate remains verifiable after its key disappears from the current DID document', async () => {
  const did = 'did:ebsi:zPastCert';
  const kid = did + '#old';
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const issued = new Date('2026-06-01T10:00:00Z');
  let stored;
  let historicalRead = false;
  const dids = didRegistry({
    identifiersUrl: 'https://registry.example/identifiers',
    async fetchRegistry(input) {
      const url = new URL(String(input));
      historicalRead = url.searchParams.get('valid-at') === issued.toISOString();
      return Response.json({
        id: did,
        assertionMethod: historicalRead ? [kid] : [],
        verificationMethod: historicalRead
          ? [{ id: kid, type: 'JsonWebKey2020', controller: did, publicKeyJwk: jwk }]
          : [],
      });
    },
  });
  const ledger = {
    chainId: 1337,
    contract: '0x' + 'cd'.repeat(20),
    async ensureRegistered(record) {
      stored = record;
    },
    async status() {
      return {
        standing: 1n,
        issuerDid: stored.issuer,
        credentialHash: stored.credentialHash,
        validFrom: BigInt(stored.validFrom),
        validUntil: BigInt(stored.validUntil),
      };
    },
  };
  const finalize = certificateFinalizer({
    now: () => issued,
    ledger,
    protection: issuanceProtection(Buffer.alloc(32, 1)),
    signingKey: async () => ({
      kid,
      sign: async (input) => sign('sha256', input, { key: privateKey, dsaEncoding: 'ieee-p1363' }),
    }),
    schemaAddress: () => 'https://registry.example/schema',
    ledgerStatusSchema: 'https://registry.example/status',
    accreditationAddress: () => 'https://registry.example/accreditation',
  });
  const token = await finalize({
    certificate: {
      id: 'abc',
      credential_id: 'urn:uuid:certificate',
      issuer_id: 'organization',
      issuer_did: did,
      certificate_number: 'HISTORY-1',
      credential_type: 'ProfessionalLicense',
      tsr_id: 'schema',
      tir_attribute_id: 'attribute',
      created_at: issued,
      valid_from: issued,
      valid_until: new Date('2027-06-01T10:00:00Z'),
    },
    claims: { course: 'Test course' },
    subject: 'did:key:zHolder',
  });
  const issuedPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  // The record the certificate registry keeps once the credential is collected.
  await ledger.ensureRegistered({
    issuer: did,
    credentialHash: '0x' + credentialHash(token).toString('hex'),
    validFrom: issuedPayload.nbf,
    validUntil: issuedPayload.exp,
  });
  const verify = credentialVerifier({
    ledger,
    ledgerStatusSchema: 'https://registry.example/status',
    assertionKey: (issuer, key, at) => dids.key(issuer, key, 'assertionMethod', at, 'P-256'),
    checkAccreditation: async () => {},
  });
  assert.equal(
    (
      await verify(token, {
        expectedHolder: 'did:key:zHolder',
        now: new Date('2026-11-03T10:00:00Z'),
      })
    ).credentialId,
    'urn:uuid:certificate',
  );
  assert.equal(historicalRead, true);
  await assert.rejects(dids.key(did, kid, 'assertionMethod'), /relationship/);
});
