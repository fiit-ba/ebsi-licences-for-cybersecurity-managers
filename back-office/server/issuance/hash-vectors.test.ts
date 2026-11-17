import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { certificateIdHash, certificateStatusKey, reasonCommitment } from './protection.ts';

// The contracts publish known answers for the hashes computed both on chain and here; their own
// tests check the Solidity against the same file, so the two cannot drift apart unnoticed.
const vectors = JSON.parse(
  await readFile(new URL('../../../contracts/test/vectors/hashes.json', import.meta.url), 'utf8'),
) as {
  statusKeys: {
    name: string;
    issuerDid: string;
    certificateId: string;
    certificateIdHash: string;
    statusKey: string;
  }[];
  reasons: { name: string; code: string; note: string; salt: string; reasonHash: string }[];
};

const hex = (digest: Buffer) => '0x' + digest.toString('hex');

test('a certificate status key matches the contracts known answers', () => {
  assert.ok(vectors.statusKeys.length > 0);
  for (const item of vectors.statusKeys) {
    assert.equal(hex(certificateIdHash(item.certificateId)), item.certificateIdHash, item.name);
    assert.equal(
      hex(certificateStatusKey(item.issuerDid, item.certificateId)),
      item.statusKey,
      item.name,
    );
  }
});

test('a reason commitment matches the contracts known answers', () => {
  assert.ok(vectors.reasons.length > 0);
  for (const item of vectors.reasons) {
    const salt = Buffer.from(item.salt.replace(/^0x/, ''), 'hex');
    assert.equal(hex(reasonCommitment(item.code, item.note, salt)), item.reasonHash, item.name);
  }
});
