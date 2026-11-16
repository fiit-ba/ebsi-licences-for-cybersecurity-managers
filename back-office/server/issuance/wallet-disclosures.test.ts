import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyObject, sign } from 'node:crypto';
import { actualWalletClients } from './fixtures/wallet.ts';
import { generateKeyPair, jwtVerify } from 'jose';
import { certificateFinalizer } from './finalizer.ts';
import { issuanceProtection } from './protection.ts';

test('the actual Wallet SD-JWT consumer reconstructs replacement credential claims and rejects tampering', async () => {
  const wallet = await actualWalletClients('https://issuer.example');
  const keys = await generateKeyPair('ES256', { extractable: true });
  const issuer = 'did:ebsi:zDisclosureCompatibility';
  const claims = {
    certificateNumber: 'COMPAT-42',
    registrationNumber: 'OLD-42',
    holderName: 'Ada',
    trainingDays: 3,
    extra: { kept: true },
  };
  const finalize = certificateFinalizer({
    signingKey: async () => ({
      kid: issuer + '#assertion',
      sign: (input) =>
        sign('sha256', input, { key: KeyObject.from(keys.privateKey), dsaEncoding: 'ieee-p1363' }),
    }),
    protection: issuanceProtection(Buffer.alloc(32, 28)),
    ledger: {
      chainId: 1337,
      contract: '0x' + 'ab'.repeat(20),
      ensureRegistered: async () => undefined,
    },
    schemaAddress: () => 'https://tsr.example/schema',
    ledgerStatusSchema: 'https://tsr.example/status',
    accreditationAddress: () => 'https://tir.example/attribute',
  });
  const token = await finalize({
    certificate: {
      id: 'df7e2d5b-aaef-4444-8151-1cf9154f60b7',
      issuer_id: 'ed4de780-87ca-48b2-82b9-05f9f73cdbfa',
      issuer_did: issuer,
      credential_id: 'urn:uuid:df7e2d5b-aaef-4444-8151-1cf9154f60b7',
      credential_type: 'ProfessionalLicense',
      certificate_number: 'COMPAT-42',
      created_at: new Date(),
      tsr_id: 'schema',
      tir_attribute_id: 'attribute',
    },
    claims,
    subject: 'did:key:zHolder',
  });
  const { jwt, disclosures } = wallet.split(token);
  const { payload } = await jwtVerify(jwt, keys.publicKey, { issuer });
  assert.deepEqual(wallet.reveal(payload, disclosures).vc.credentialSubject, {
    id: 'did:key:zHolder',
    ...claims,
  });
  assert.deepEqual(wallet.reveal(payload, []).vc.credentialSubject, {
    id: 'did:key:zHolder',
    certificateNumber: 'COMPAT-42',
  });
  assert.throws(() => wallet.reveal(payload, [...disclosures, disclosures[0]]));
  assert.throws(() =>
    wallet.reveal(payload, [
      Buffer.from(JSON.stringify(['salt', 'holderName', 'Forged'])).toString('base64url'),
    ]),
  );
});
