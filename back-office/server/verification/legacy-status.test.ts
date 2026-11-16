import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { legacyStatusVerifier } from './legacy-status.ts';

test('legacy status lists require a signed matching list and use most-significant-bit order', async () => {
  const issuer = 'did:ebsi:zLegacy';
  const revocation = 'https://tir.example/proxy/revocation';
  const suspension = 'https://tir.example/proxy/suspension';
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const otherKey = (await generateKeyPair('ES256')).privateKey;
  const documents = new Map();
  async function publish(url, purpose, { bitstring = false, id = url, key = privateKey } = {}) {
    const bits = Buffer.alloc(16 * 1024);
    bits[0] = 0x81;
    const gzip = gzipSync(bits);
    const subject = bitstring ? 'BitstringStatusList' : 'StatusList2021';
    const token = await new SignJWT({
      vc: {
        issuer,
        id,
        type: ['VerifiableCredential', subject + 'Credential'],
        credentialSubject: {
          type: subject,
          statusPurpose: purpose,
          encodedList: bitstring ? 'u' + gzip.toString('base64url') : gzip.toString('base64'),
        },
      },
    })
      .setIssuer(issuer)
      .setProtectedHeader({ alg: 'ES256', kid: issuer + '#status' })
      .sign(key);
    documents.set(url, token);
  }
  await publish(revocation, 'revocation');
  await publish(suspension, 'suspension', { bitstring: true });
  const fetches = [];
  const verify = legacyStatusVerifier({
    allowedLists: [
      { url: revocation, issuer },
      { url: suspension, issuer },
    ],
    assertionKey: async () => exportJWK(publicKey),
    async fetchList(url, options) {
      assert.equal(options.redirect, 'error');
      fetches.push(url);
      return Response.json(documents.get(url));
    },
  });
  const revoked = {
    type: 'StatusList2021Entry',
    statusPurpose: 'revocation',
    statusListIndex: '0',
    statusListCredential: revocation,
  };
  const suspended = {
    type: 'BitstringStatusListEntry',
    statusPurpose: 'suspension',
    statusListIndex: '7',
    statusListCredential: suspension,
  };
  await assert.rejects(verify([revoked], issuer), { outcome: 'REVOKED' });
  await assert.rejects(verify([suspended], issuer), { outcome: 'SUSPENDED' });
  await verify(
    [
      { ...revoked, statusListIndex: '1' },
      { ...suspended, statusListIndex: '6' },
    ],
    issuer,
  );
  await assert.rejects(verify([{ ...revoked, statusListIndex: '131072' }], issuer), {
    code: 'LegacyStatusUnavailable',
  });
  await assert.rejects(
    verify([{ ...revoked, statusListCredential: 'https://other.example/list' }], issuer),
    { code: 'LegacyStatusUnavailable' },
  );
  assert.ok(fetches.every((url) => [revocation, suspension].includes(url)));
  await publish(revocation, 'revocation', { id: 'https://tir.example/different-list' });
  await assert.rejects(verify([revoked], issuer), { code: 'LegacyStatusUnavailable' });
  await publish(revocation, 'revocation', { key: otherKey });
  await assert.rejects(verify([revoked], issuer), { code: 'LegacyStatusUnavailable' });
});

test('only an enrolled JWT can use legacy status, and a ledger entry disables that path', async () => {
  const { credentialVerifier } = await import('./credential.ts');
  const { secretDigest } = await import('../issuance/protection.ts');
  const issuer = 'did:ebsi:zLegacy';
  const holder = 'did:key:zHolder';
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const now = new Date('2026-10-25T12:00:00Z');
  const entry = {
    type: 'StatusList2021Entry',
    statusPurpose: 'revocation',
    statusListIndex: '0',
    statusListCredential: 'https://tir.example/legacy',
  };
  const vc = {
    id: 'urn:uuid:7a719bc0-6236-4682-b23d-7799c8cbf60f',
    issuer,
    type: ['VerifiableCredential', 'ProfessionalLicense'],
    issuanceDate: '2026-10-24T12:00:00Z',
    expirationDate: '2027-10-24T12:00:00Z',
    credentialSubject: { id: holder, registrationNumber: 'legacy-1' },
    credentialSchema: {
      id: 'https://tsr.example/schemas/legacy',
      type: 'FullJsonSchemaValidator2021',
    },
    termsOfUse: { type: 'IssuanceCertificate', id: 'https://tir.example/attribute' },
    credentialStatus: entry,
  };
  const sign = (payload) =>
    new SignJWT(payload)
      .setIssuer(issuer)
      .setProtectedHeader({ alg: 'ES256', kid: issuer + '#key' })
      .sign(privateKey);
  const historical = await sign({ vc });
  const reSigned = await sign({ vc });
  const mixed = await sign({
    vc: {
      ...vc,
      credentialSubject: { id: holder, certificateNumber: 'legacy-1' },
      type: ['VerifiableCredential', 'VerifiableAttestation', 'ProfessionalLicense'],
      credentialStatus: [{ type: 'PlrLedgerStatusEntry' }, entry],
    },
    jti: vc.id,
    sub: holder,
    nbf: Date.parse(vc.issuanceDate) / 1000,
    exp: Date.parse(vc.expirationDate) / 1000,
  });
  const enrolled = new Set([historical, mixed].map((jwt) => secretDigest(jwt).toString('hex')));
  let legacyCalls = 0;
  const verify = credentialVerifier({
    assertionKey: async () => exportJWK(publicKey),
    checkAccreditation: async () => {},
    ledger: {
      contract: '0x' + 'ab'.repeat(20),
      chainId: 1337,
      async status() {
        assert.fail('Historical credentials must use the legacy status adapter.');
      },
    },
    legacy: {
      includes: (digest) => enrolled.has(digest),
      async verifyStatus(entries, did) {
        legacyCalls++;
        assert.deepEqual(entries, [entry]);
        assert.equal(did, issuer);
      },
    },
  });
  const verified = await verify(historical, { now, expectedHolder: holder });
  assert.equal(verified.credentialId, vc.id);
  assert.equal(verified.statusKey, null);
  await assert.rejects(verify(reSigned, { now, expectedHolder: holder }), {
    code: 'InvalidCredentialBinding',
  });
  await assert.rejects(verify(mixed, { now, expectedHolder: holder }), {
    code: 'InvalidLedgerReference',
  });
  assert.equal(legacyCalls, 1);
});
