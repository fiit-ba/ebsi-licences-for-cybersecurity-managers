import type { RecoveryMailSender } from './recovery-types.ts';

/**
 * Create the existing deployment's Postmark recovery-email transport.
 * @param apiKey - Postmark server token, retained only in the server process.
 * @param from - Verified sender address configured by the deployment operator.
 * @param request - Fetch implementation; injectable for isolated provider tests.
 * @returns A sender that accepts only successful provider acknowledgements.
 * @throws Error for missing configuration; sender rejects on timeout/provider failure.
 * @remarks Redirects are forbidden. Provider bodies and message contents are never
 * included in errors, preventing bearer-link or address disclosure through logs.
 */
export function postmarkRecoveryMail(
  apiKey: string,
  from: string,
  request: typeof fetch = fetch,
): RecoveryMailSender {
  if (!apiKey || !from || /[\r\n]/.test(apiKey + from))
    throw new Error('Configure Postmark and its verified sender.');
  return async (mail) => {
    try {
      if (!/^[^\s@,;<>]+@[^\s@,;<>]+$/u.test(mail.to)) throw new Error();
      const response = await request('https://api.postmarkapp.com/email', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-Postmark-Server-Token': apiKey,
        },
        body: JSON.stringify({
          From: from,
          To: mail.to,
          Subject:
            mail.purpose === 'activation' ? 'Atest account activation' : 'Atest password reset',
          TrackOpens: false,
          TrackLinks: 'None',
          TextBody: `${mail.purpose === 'activation' ? `Your Atest account has been created. Your username: ${mail.username ?? ''}. To set your password` : 'To reset your password'}, open this link:\n\n${mail.url}\n\nThe link expires at ${mail.expiresAt.toISOString()}.\nIf you did not request this, you can ignore this message.`,
        }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result?.ErrorCode !== 0) throw new Error();
    } catch {
      throw new Error('The password recovery email was not acknowledged by its provider.');
    }
  };
}
