import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { issuanceProtection } from '../issuance/protection.ts';
import { storeReason, openReason } from './reason-storage.ts';

test('private reason note and salt remain encrypted, commitment-bound and independently disclosable', async () => {
  const protection = issuanceProtection(Buffer.alloc(32, 91));
  const salt = randomBytes(32);
  const reason = await storeReason('other', 'private case 😀', salt, protection);
  assert.equal(reason.reason_note.includes('private case'), false);
  assert.equal(reason.reason_salt.includes(salt), false);
  assert.notEqual(reason.reason_salt.length, 32);
  assert.deepEqual(await openReason(reason, protection), {
    code: 'other',
    note: 'private case 😀',
    salt,
  });
  await assert.rejects(() => openReason(reason), /unavailable/);
  const other = await storeReason('other', 'another case', randomBytes(32), protection);
  await assert.rejects(() => openReason({ ...reason, reason_salt: other.reason_salt }, protection));
  await assert.rejects(() => openReason({ ...reason, reason_note: other.reason_note }, protection));
  await assert.rejects(() => openReason({ ...reason, reason_code: 'issued_in_error' }, protection));
  const plain = await storeReason('resolved', '', salt);
  assert.deepEqual(await openReason(plain), { code: 'resolved', note: '', salt });
});
