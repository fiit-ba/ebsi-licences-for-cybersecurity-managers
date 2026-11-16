import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, passwordMatches } from './passwords.ts';

test('native passwords retain fresh salts and exact Unicode matching', async () => {
  const password = 'Žltý-🔐-passphrase';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(await passwordMatches(password, first), true);
  assert.equal(await passwordMatches(password + ' ', first), false);
  assert.equal(await passwordMatches(password.normalize('NFD'), first), false);
});

test('missing, disabled, malformed and foreign password encodings cannot authenticate', async () => {
  for (const encoded of [
    undefined,
    '',
    '!disabled',
    'argon2$unsupported',
    'pbkdf2_sha256$1000000$salt$digest',
    'scrypt$16384$salt$8$1$digest',
    '0:0',
    '0'.repeat(161),
    '0'.repeat(32) + ':zz' + '0'.repeat(126),
    'x'.repeat(513),
  ])
    assert.equal(await passwordMatches('test', encoded), false);
});
