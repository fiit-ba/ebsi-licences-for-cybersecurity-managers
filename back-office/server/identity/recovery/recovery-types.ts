/** Private message passed only to the configured recovery email transport. */
export interface RecoveryMail {
  to: string;
  url: string;
  expiresAt: Date;
  purpose?: 'recovery' | 'activation';
  username?: string;
}

/** Email delivery operation; completion means the provider accepted the message. */
export type RecoveryMailSender = (mail: RecoveryMail) => Promise<void>;

/** Recovery service configuration retaining existing token and request lifetimes. */
export interface PasswordRecoveryOptions {
  key: Buffer;
  publicOrigin: string;
  sendMail: RecoveryMailSender;
  expiryHours?: number;
  requestsPerDay?: number;
  reportDeliveryError?: () => void;
  activationExpiryHours?: number;
}

/** Locked account fields needed for password policy, eligibility and token binding. */
export interface RecoveryAccount {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  auth_version: number;
}

/** Durable reset challenge and email retry state. */
export interface RecoveryChallenge {
  account_id: number;
  nonce: Buffer;
  token_digest: Buffer;
  auth_version: number;
  email: string;
  expires_at: Date;
  reusable?: boolean;
  purpose: 'recovery' | 'activation';
}
import type { PoolClient } from 'pg';

/** Durable post-creation work executed before the account transaction commits. */
export type AccountCreatedHook = (client: PoolClient, account: number) => Promise<void>;
