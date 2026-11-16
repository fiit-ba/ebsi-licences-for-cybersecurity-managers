import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postmarkRecoveryMail } from './recovery-mail.ts';
import { configuredPasswordRecovery } from './recovery-runtime.ts';
import type { Pool } from 'pg';

test('recovery transport pins Postmark, forbids redirects and requires provider acknowledgement', async () => {
  const mail = {
    to: 'private@example.test',
    url: 'https://console.example.test/password_reset/#' + 'ab'.repeat(32),
    expiresAt: new Date('2030-01-01T00:00:00Z'),
  };
  let code = 0;
  const sender = postmarkRecoveryMail(
    'private-provider-token',
    'sender@example.test',
    async (url, options) => {
      assert.equal(url, 'https://api.postmarkapp.com/email');
      assert.equal(options?.method, 'POST');
      assert.equal(options?.redirect, 'error');
      assert.ok(options?.signal);
      const body = JSON.parse(options?.body as string);
      assert.equal(body.To, mail.to);
      assert.equal(body.TrackOpens, false);
      assert.equal(body.TrackLinks, 'None');
      assert.ok(body.TextBody.includes(mail.url));
      return Response.json({ ErrorCode: code, Message: mail.url });
    },
  );
  await sender(mail);
  code = 406;
  await assert.rejects(sender(mail), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(mail.url), false);
    assert.equal(error.message.includes(mail.to), false);
    assert.equal(error.message.includes('private-provider-token'), false);
    return true;
  });
  const unavailable = postmarkRecoveryMail(
    'private-provider-token',
    'sender@example.test',
    async () => new Response(mail.url, { status: 503 }),
  );
  await assert.rejects(unavailable(mail), /not acknowledged/);
  assert.throws(() => postmarkRecoveryMail('key', 'bad\r\nheader'), /Configure/);
  await assert.rejects(
    sender({ ...mail, to: 'first@example.test,second@example.test' }),
    /not acknowledged/,
  );
});

test('recovery and activation lifetimes are independently bounded without exposing secrets', () => {
  const env = {
    BACK_OFFICE_PASSWORD_RECOVERY_ENABLED: 'true',
    BACK_OFFICE_PASSWORD_RECOVERY_KEY: Buffer.alloc(32, 12).toString('base64'),
    BACK_OFFICE_PUBLIC_ORIGIN: 'https://accounts.example.test',
    POSTMARK_API_KEY: 'private-postmark-token',
    DEFAULT_FROM_EMAIL: 'sender@example.test',
  };
  for (const settings of [
    { BACK_OFFICE_ACTIVATION_EXPIRY_HOURS: '0' },
    { BACK_OFFICE_ACTIVATION_EXPIRY_HOURS: '169' },
    { BACK_OFFICE_PASSWORD_RECOVERY_EXPIRY_HOURS: 'invalid' },
  ])
    assert.throws(
      () => configuredPasswordRecovery({} as Pool, { ...env, ...settings }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes('private-postmark-token'), false);
        return true;
      },
    );
  assert.ok(
    configuredPasswordRecovery({} as Pool, {
      ...env,
      BACK_OFFICE_ACTIVATION_EXPIRY_HOURS: '72',
      BACK_OFFICE_PASSWORD_RECOVERY_EXPIRY_HOURS: '24',
    }),
  );
});
