import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { passwordPolicyCodes, passwordPolicyMessages } from './password-policy.ts';

const randomText = createHash('sha512').update('public-password-policy-test-fixture').digest('hex');

test('password length counts Unicode code points and rejects oversized input before scoring', () => {
  for (const password of ['', randomText.slice(0, 14), '🔐'.repeat(14)])
    assert.deepEqual(passwordPolicyCodes(password, {}), ['password_too_short']);
  assert.deepEqual(passwordPolicyCodes(randomText.slice(0, 15), {}), []);
  assert.deepEqual(passwordPolicyCodes(randomText, {}), []);
  assert.deepEqual(passwordPolicyCodes(randomText.slice(0, 127) + '🔐', {}), []);
  for (const password of [randomText + 'x', '🔐'.repeat(129), 'x'.repeat(2_621_440)])
    assert.deepEqual(passwordPolicyCodes(password, {}), ['password_too_long']);
});

test('local matching rejects common variations, repetition and keyboard/sequence patterns', () => {
  for (const password of [
    'passwordpassword',
    'PasswordPassword1!',
    'P@ssw0rdP@ssw0rd!',
    'Qwerty123456789!',
    'abcdefghijklmnopqrstuvwxyz',
    '🔐'.repeat(128),
    '²'.repeat(20),
    '١٢٣٤٥٦٧٨٩٠١٢٣٤٥',
    ' '.repeat(20),
  ])
    assert.deepEqual(passwordPolicyCodes(password, {}), ['password_too_weak'], password);
});

test('phrases, Unicode, spaces and unpredictable numeric passwords have no character-class quota', () => {
  for (const password of [
    'correct horse battery staple',
    'Unrelated marmot telescope 53!',
    'javor lipa oblak kometa 42',
    '238615940782613',
    '  Unrelated marmot telescope 53!  ',
    randomText.slice(0, 20) + 'Ž🔐',
  ])
    assert.deepEqual(passwordPolicyCodes(password, {}), [], password);
});

test('the documented development default satisfies every seeded account identity', () => {
  for (const username of ['alice', 'bob', 'supervisor', 'mirri'])
    assert.deepEqual(passwordPolicyCodes('Atest-2026!Demo', { username }), [], username);
});

test('personal words affect only this account and this call, without rejecting arbitrary anagrams', () => {
  const username = 'b7f4d29a8c1e6a50';
  assert.deepEqual(passwordPolicyCodes(username, {}), []);
  assert.deepEqual(passwordPolicyCodes(username, { username }), ['password_too_weak']);
  assert.deepEqual(passwordPolicyCodes(username.split('').reverse().join(''), { username }), [
    'password_too_weak',
  ]);
  assert.deepEqual(passwordPolicyCodes(username, {}), []);
  assert.deepEqual(passwordPolicyCodes('b4f729adc18e065a', { username }), []);
  for (const identity of [
    { email: username + '@example.test' },
    { firstName: username },
    { lastName: username },
  ])
    assert.deepEqual(passwordPolicyCodes(username, identity), ['password_too_weak']);
  assert.deepEqual(passwordPolicyCodes('independent stellar magnolia phrase', { username }), []);
});

test('refusals expose static actionable messages without matched words or estimated guesses', () => {
  for (const candidate of ['short', 'passwordpassword', randomText + 'x']) {
    const codes = passwordPolicyCodes(candidate, {});
    assert.equal(codes.length, 1);
    const message = passwordPolicyMessages[codes[0]];
    assert.ok(message);
    assert.equal(message.includes(candidate), false);
  }
});
