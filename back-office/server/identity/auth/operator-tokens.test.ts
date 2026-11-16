import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, decodeJwt } from 'jose';
import { operatorTokens } from './tokens.ts';

const secret = 'operator-token-regression-secret-'.repeat(2);

test('operator sessions retain existing lifetimes and reject refresh tokens as access', async () => {
  const tokens = operatorTokens(secret);
  const session = await tokens.pair({
    id: 42,
    username: 'alice',
    email: 'alice@example.test',
    auth_version: 7,
  });
  const access = decodeJwt(session.access);
  const refresh = decodeJwt(session.refresh);
  assert.equal(access.exp! - access.iat!, 900);
  assert.equal(refresh.exp! - refresh.iat!, 3600);
  assert.equal(await tokens.accountId(session.access, 7), 42);
  assert.equal(await tokens.accountId(session.access, 8), undefined);
  assert.equal(await tokens.accountId(session.refresh), undefined);
  assert.notEqual(session.access, (await tokens.pair({ id: 42 })).access);
});

test('operator access validation rejects forged, expired and confused identity claims', async () => {
  const tokens = operatorTokens(secret);
  const valid = {
    token_type: 'access',
    user_id: 42,
    auth_version: 7,
    sub: '42',
    iss: 'atest-back-office',
    exp: Math.floor(Date.now() / 1000) + 900,
  };
  const cases = [
    { ...valid, iss: 'another-application' },
    { ...valid, exp: 1 },
    { ...valid, exp: undefined },
    { ...valid, nbf: Math.floor(Date.now() / 1000) + 900 },
    { ...valid, sub: '43' },
    { ...valid, user_id: '42' },
    { ...valid, user_id: 42.5 },
    { ...valid, user_id: -42 },
    { ...valid, user_id: 2147483648 },
    { ...valid, auth_version: -1 },
    { ...valid, auth_version: '7' },
    { ...valid, auth_version: undefined },
    { ...valid, token_type: 'refresh' },
    { ...valid, token_type: undefined },
  ];
  for (const claims of cases) {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(Buffer.from(secret));
    assert.equal(await tokens.accountId(token), undefined);
  }
  const wrongKey = await new SignJWT(valid)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(Buffer.alloc(64, 17));
  const wrongAlgorithm = await new SignJWT(valid)
    .setProtectedHeader({ alg: 'HS384' })
    .sign(Buffer.from(secret));
  for (const token of [wrongKey, wrongAlgorithm, undefined, '', 'not.a.jwt']) {
    assert.equal(await tokens.accountId(token), undefined);
  }
});
