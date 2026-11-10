import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import { postgresKmsIssuerSigning } from './kms-signing.ts';
import type { KmsSigningClient } from './kms-types.ts';

test('KMS issuer signing uses a digest and verifies the signature against the registered public key', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const issuer = 'did:ebsi:zTest';
  const organization = '128faeb4-36b3-4452-95db-5a24034fc0e4';
  const message = Buffer.from('header.payload');
  const database = {
    async query(_query, params) {
      assert.deepEqual(params, [organization, issuer]);
      return {
        rows: [
          {
            kid: issuer + '#current',
            kms_key_id: 'test-id',
            public_jwk: publicKey.export({ format: 'jwk' }),
          },
        ],
      };
    },
  };
  let signature = sign('sha256', message, privateKey);
  const kms: KmsSigningClient = {
    async send(command) {
      assert.deepEqual(command.input, {
        KeyId: 'test-id',
        Message: createHash('sha256').update(message).digest(),
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      });
      return { Signature: signature, SigningAlgorithm: 'ECDSA_SHA_256' };
    },
  };

  const key = await postgresKmsIssuerSigning(database, kms)(issuer, organization);
  const raw = await key.sign(message);
  assert.equal(key.kid, issuer + '#current');
  assert.equal(raw.length, 64);
  assert.ok(verify('sha256', message, { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw));

  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  signature = sign('sha256', message, other.privateKey);
  await assert.rejects(key.sign(message), /does not match/);
  signature = Buffer.from('3006020180020101', 'hex');
  await assert.rejects(key.sign(message), /invalid ECDSA scalar/);
});
