import type { Pool } from 'pg';
import { postgresPasswordRecovery } from './password-recovery.ts';
import { postmarkRecoveryMail } from './recovery-mail.ts';

/**
 * Compose recovery only when its dedicated key, public origin and mail settings are supplied.
 * @param database - Application PostgreSQL pool.
 * @param env - Deployment environment; injectable without modifying process globals.
 * @returns Recovery operations, or undefined when explicitly disabled/unconfigured.
 * @throws Error for partial or invalid enabled configuration.
 * @remarks This changes no production routing and never logs reset links or mail bodies.
 */
export function configuredPasswordRecovery(database: Pool, env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.BACK_OFFICE_PASSWORD_RECOVERY_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled))
    throw new Error('Set BACK_OFFICE_PASSWORD_RECOVERY_ENABLED to true or false.');
  if (enabled === 'false') return;
  const encoded = env.BACK_OFFICE_PASSWORD_RECOVERY_KEY ?? '';
  const key = Buffer.from(encoded, 'base64');
  if (
    key.length !== 32 ||
    key.toString('base64') !== encoded ||
    !env.BACK_OFFICE_PUBLIC_ORIGIN ||
    !env.POSTMARK_API_KEY ||
    !env.DEFAULT_FROM_EMAIL
  ) {
    throw new Error(
      'Enabled recovery requires a canonical base64 32-byte key, public origin and Postmark sender configuration.',
    );
  }
  return postgresPasswordRecovery(database, {
    key,
    publicOrigin: env.BACK_OFFICE_PUBLIC_ORIGIN,
    expiryHours: Number(env.BACK_OFFICE_PASSWORD_RECOVERY_EXPIRY_HOURS ?? 24),
    activationExpiryHours: Number(env.BACK_OFFICE_ACTIVATION_EXPIRY_HOURS ?? 72),
    sendMail: postmarkRecoveryMail(env.POSTMARK_API_KEY, env.DEFAULT_FROM_EMAIL),
    reportDeliveryError: () => console.error('Password recovery delivery remains pending.'),
  });
}
