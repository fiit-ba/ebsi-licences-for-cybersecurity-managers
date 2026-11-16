import { enqueueAfterCommit } from '../../background/queue.ts';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { hashPassword } from '../auth/passwords.ts';
import { passwordPolicyCodes, passwordPolicyMessages } from '../auth/password-policy.ts';
import { trimIdentityField } from '../input-text.ts';
import type {
  PasswordRecoveryOptions,
  RecoveryAccount,
  RecoveryChallenge,
} from './recovery-types.ts';

const daySeconds = 86_400;
const invalidToken = 'The OTP password entered is not valid. Please check and try again.';
const eligibleAccount = `
  a.active AND a.password_hash NOT LIKE '!%' AND NOT EXISTS (
    SELECT 1 FROM accredited_organizations o
    LEFT JOIN accredited_organizations parent ON parent.id = o.parent_id
    LEFT JOIN accredited_organizations root ON root.id = parent.parent_id
    WHERE o.account_id = a.id
      AND LEAST(o.revoked_at, parent.revoked_at, root.revoked_at) <= statement_timestamp()
  )
`;

/** Public recovery refusal preserving the existing endpoint response shape. */
export class PasswordRecoveryError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly retryAfter?: number;

  /**
   * Construct a recovery refusal without including secrets in its message.
   * @param status - HTTP refusal status.
   * @param body - Public field errors or detail.
   * @param retryAfter - Optional seconds until another request is permitted.
   */
  constructor(status: number, body: Record<string, unknown>, retryAfter?: number) {
    super('Password recovery was refused.');
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/**
 * Decode the existing nonblank token input without unbounded hashing work.
 * @param input - Untrusted request object.
 * @returns The normalized bearer token.
 * @throws PasswordRecoveryError for a missing or invalid token.
 */
function tokenInput(input: Record<string, unknown>): string {
  if (typeof input.token !== 'string' || !trimIdentityField(input.token)) {
    throw new PasswordRecoveryError(400, { token: ['This field is required.'] });
  }
  const token = trimIdentityField(input.token);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new PasswordRecoveryError(404, { detail: invalidToken });
  return token;
}

/**
 * Derive the database lookup digest for an already bounded bearer token.
 * @param token - Normalized reset token.
 * @returns A 32-byte digest without retaining the bearer value.
 */
function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Create the independent recovery API and its durable email worker.
 * @param database - PostgreSQL pool for reset/account state and rate limits.
 * @param options - Dedicated secret, fixed public origin, delivery and existing lifetimes.
 * @returns Request, validation, confirmation and bounded retry operations.
 * @throws Error for invalid deployment configuration; operations reject database/crypto errors.
 * @remarks Tokens are bound to account version and email. Reset confirmation and
 * account edits lock the account before reset rows, avoiding reversed lock order.
 */
export function postgresPasswordRecovery(database: Pool, options: PasswordRecoveryOptions) {
  const {
    key,
    sendMail,
    expiryHours = 24,
    requestsPerDay = 3,
    reportDeliveryError = () => {},
    activationExpiryHours = 72,
  } = options;
  const origin = new URL(options.publicOrigin);
  if (
    key.length !== 32 ||
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol === 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) ||
    !Number.isSafeInteger(expiryHours) ||
    expiryHours < 1 ||
    expiryHours > 168 ||
    !Number.isSafeInteger(requestsPerDay) ||
    requestsPerDay < 1 ||
    requestsPerDay > 1000 ||
    !Number.isSafeInteger(activationExpiryHours) ||
    activationExpiryHours < 1 ||
    activationExpiryHours > 168
  ) {
    throw new Error('Invalid password recovery configuration.');
  }

  /**
   * Derive a repeatable secret from a private key and one durable random nonce.
   * @param challenge - Account/version-bound challenge metadata.
   * @returns The 64-character bearer value, never stored unencrypted.
   */
  function bearer(
    challenge: Pick<RecoveryChallenge, 'account_id' | 'auth_version' | 'nonce'>,
  ): string {
    return createHmac('sha256', key)
      .update(`atest-password-reset-v1:${challenge.account_id}:${challenge.auth_version}:`)
      .update(challenge.nonce)
      .digest('hex');
  }

  /**
   * Enforce the existing shared sliding 24-hour request limit for one client.
   * @param clientIdentity - Trusted ingress-derived address; raw forwarding headers are not accepted here.
   * @returns Completion after counting the request, including unknown-account requests.
   * @throws PasswordRecoveryError with 429 and retry time when the window is full; database errors.
   */
  async function limitRequest(clientIdentity: string): Promise<void> {
    const bucket = createHmac('sha256', key).update('reset-rate:').update(clientIdentity).digest();
    await transaction(database, async (client) => {
      await client.query(
        `INSERT INTO operator_recovery_limits(bucket, expires_at)
        VALUES ($1, clock_timestamp() + interval '1 day') ON CONFLICT DO NOTHING`,
        [bucket],
      );
      const {
        rows: [state],
      } = await client.query<{ requests: Date[]; now: Date }>(
        `
        SELECT ARRAY(SELECT instant FROM unnest(requests) instant
          WHERE instant > clock_timestamp() - interval '1 day' ORDER BY instant) AS requests,
          clock_timestamp() AS now
        FROM operator_recovery_limits WHERE bucket = $1 FOR UPDATE
      `,
        [bucket],
      );
      if (state.requests.length >= requestsPerDay) {
        const wait = Math.max(
          1,
          Math.ceil((+state.requests[0] + daySeconds * 1000 - +state.now) / 1000),
        );
        throw new PasswordRecoveryError(429, { detail: 'Request was throttled.' }, wait);
      }
      await client.query(
        `UPDATE operator_recovery_limits
        SET requests = $2::timestamptz[], expires_at = $3::timestamptz + interval '1 day' WHERE bucket = $1`,
        [bucket, [...state.requests, state.now], state.now],
      );
    });
  }

  /**
   * Lock a currently eligible account before touching its reset challenge.
   * @param client - Caller-owned transaction.
   * @param id - Account identifier obtained from an exact token lookup.
   * @returns Eligible account fields, or undefined if its state no longer permits recovery.
   * @throws Database errors.
   */
  async function accountForReset(
    client: PoolClient,
    id: number,
  ): Promise<RecoveryAccount | undefined> {
    return (
      await client.query<RecoveryAccount>(
        `SELECT a.* FROM operator_accounts a
      WHERE a.id = $1 AND ${eligibleAccount} FOR UPDATE OF a`,
        [id],
      )
    ).rows[0];
  }

  /**
   * Resolve and lock an unexpired challenge after rechecking the live account state.
   * @param client - Caller-owned transaction.
   * @param token - Normalized bearer input.
   * @returns Current account and challenge.
   * @throws PasswordRecoveryError for a missing, expired, consumed or stale challenge; database errors.
   */
  async function currentChallenge(client: PoolClient, token: string) {
    const hashed = digest(token);
    const candidate = (
      await client.query<{ account_id: number }>(
        'SELECT account_id FROM operator_password_resets WHERE token_digest = $1',
        [hashed],
      )
    ).rows[0];
    const account = candidate && (await accountForReset(client, candidate.account_id));
    const reset =
      account &&
      (
        await client.query<RecoveryChallenge>(
          `SELECT * FROM operator_password_resets
      WHERE account_id = $1 AND token_digest = $2 AND auth_version = $3 AND email = $4
        AND expires_at >= clock_timestamp() FOR UPDATE`,
          [account.id, hashed, account.auth_version, account.email],
        )
      ).rows[0];
    if (!account || !reset) throw new PasswordRecoveryError(404, { detail: invalidToken });
    return { account, reset };
  }

  /**
   * Resolve the current one-time bearer to its locked eligible account.
   * @param client - Caller-owned transaction.
   * @param input - Untrusted recovery token.
   * @returns A locked eligible account bound to this exact reset link.
   * @throws PasswordRecoveryError for stale, consumed or malformed links; database errors.
   */
  async function resetAccount(
    client: PoolClient,
    input: Record<string, unknown>,
  ): Promise<RecoveryAccount> {
    if (input.uid !== undefined) throw new PasswordRecoveryError(404, { detail: invalidToken });
    return (await currentChallenge(client, tokenInput(input))).account;
  }

  /**
   * Purge the existing expired challenge/throttle batches without sending mail.
   * @returns Completion after bounded cleanup of expired recovery state.
   * @throws Database errors if cleanup cannot be committed.
   */
  async function purgeExpired() {
    await database.query(`DELETE FROM operator_password_resets WHERE expires_at < clock_timestamp() AND account_id IN (
      SELECT account_id FROM operator_password_resets WHERE expires_at < clock_timestamp() ORDER BY expires_at LIMIT 100)`);
    await database.query(`DELETE FROM operator_recovery_limits WHERE expires_at < clock_timestamp() AND bucket IN (
      SELECT bucket FROM operator_recovery_limits WHERE expires_at < clock_timestamp() ORDER BY expires_at LIMIT 100)`);
  }

  return {
    purgeExpired,
    /**
     * Queue the existing account-invitation password setup mail in its creation transaction.
     * @param client - Account creation transaction, with the new account row already inserted.
     * @param id - Newly created account ID.
     * @returns Completion after durable activation state, or no work for superusers/ineligible accounts.
     * @throws Database/crypto errors roll back account creation if durable challenge storage fails.
     * @remarks Broker submission follows commit; its failure never rolls back the account.
     */
    async queueActivation(client: PoolClient, id: number): Promise<void> {
      const account = (
        await client.query<RecoveryAccount>(
          `SELECT a.* FROM operator_accounts a
        WHERE a.id=$1 AND NOT a.is_superuser AND a.email<>'' AND ${eligibleAccount} FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!account) return;
      const nonce = randomBytes(32);
      const token = bearer({ account_id: id, auth_version: account.auth_version, nonce });
      await client.query(
        `INSERT INTO operator_password_resets(account_id,nonce,token_digest,auth_version,email,expires_at,purpose)
        VALUES ($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 hour','activation')`,
        [id, nonce, digest(token), account.auth_version, account.email, activationExpiryHours],
      );
      enqueueAfterCommit(client, { operation: 'send-recovery', accountId: id });
    },
    /**
     * Queue recovery for an active usable account without disclosing whether it exists.
     * @param input - Existing JSON email field.
     * @param clientIdentity - Address resolved by the trusted ingress configuration.
     * @returns The existing generic OK response for known, unknown or ineligible addresses.
     * @throws PasswordRecoveryError for malformed input or throttling; database/crypto errors.
     */
    async requestReset(input: Record<string, unknown>, clientIdentity: string) {
      await limitRequest(clientIdentity);
      const email = typeof input.email === 'string' ? trimIdentityField(input.email) : '';
      if (
        !email ||
        email.length > 320 ||
        !/^[^\s@]+@(?:localhost|[^\s@]+\.[^\s@]+)$/iu.test(email) ||
        /[\r\n]/.test(email)
      ) {
        throw new PasswordRecoveryError(400, { email: ['Enter a valid email address.'] });
      }
      await transaction(database, async (client) => {
        const account = (
          await client.query<RecoveryAccount>(
            `SELECT a.* FROM operator_accounts a
          WHERE lower(a.email) = lower($1) AND ${eligibleAccount} ORDER BY a.id LIMIT 1 FOR UPDATE OF a`,
            [email],
          )
        ).rows[0];
        if (!account) return;
        enqueueAfterCommit(client, { operation: 'send-recovery', accountId: account.id });
        const previous = (
          await client.query<RecoveryChallenge>(
            `SELECT *, expires_at >= clock_timestamp() AS reusable
          FROM operator_password_resets WHERE account_id = $1 AND purpose='recovery' FOR UPDATE`,
            [account.id],
          )
        ).rows[0];
        if (
          previous?.reusable &&
          previous.auth_version === account.auth_version &&
          previous.email === account.email
        ) {
          await client.query(
            "UPDATE operator_password_resets SET requested_at = clock_timestamp() WHERE account_id = $1 AND purpose='recovery'",
            [account.id],
          );
          return;
        }
        const nonce = randomBytes(32);
        const token = bearer({ account_id: account.id, auth_version: account.auth_version, nonce });
        await client.query(
          `INSERT INTO operator_password_resets(account_id, nonce, token_digest, auth_version, email, expires_at)
          VALUES ($1,$2,$3,$4,$5,clock_timestamp() + $6 * interval '1 hour')
          ON CONFLICT (account_id,purpose) DO UPDATE SET nonce = EXCLUDED.nonce, token_digest = EXCLUDED.token_digest,
            auth_version = EXCLUDED.auth_version, email = EXCLUDED.email, created_at = clock_timestamp(),
            expires_at = EXCLUDED.expires_at, requested_at = clock_timestamp(), delivered_at = NULL,
            attempted_at = NULL, attempts = 0`,
          [account.id, nonce, digest(token), account.auth_version, account.email, expiryHours],
        );
      });
      return { status: 'OK' };
    },

    /**
     * Check that a reset bearer still belongs to an eligible current account.
     * @param input - Existing JSON token field.
     * @returns The existing OK response without username/email disclosure.
     * @throws PasswordRecoveryError for malformed or invalid tokens; database errors.
     */
    async validateToken(input: Record<string, unknown>) {
      await transaction(database, (client) => resetAccount(client, input));
      return { status: 'OK' };
    },

    /**
     * Atomically replace the password, consume reset state and invalidate old sessions.
     * @param input - Existing JSON token and new-password fields.
     * @returns The existing OK response after the journal and password commit together.
     * @throws PasswordRecoveryError for invalid tokens or weak passwords; database/crypto errors.
     */
    async confirmReset(input: Record<string, unknown>) {
      if (typeof input.password !== 'string' || !trimIdentityField(input.password)) {
        throw new PasswordRecoveryError(400, { password: ['This field is required.'] });
      }
      const password = trimIdentityField(input.password);
      await transaction(database, async (client) => {
        const account = await resetAccount(client, input);
        const codes = passwordPolicyCodes(password, {
          username: account.username,
          email: account.email,
          firstName: account.first_name,
          lastName: account.last_name,
        });
        if (codes.length) {
          throw new PasswordRecoveryError(400, {
            password: codes.map((code) => passwordPolicyMessages[code]),
          });
        }
        const hash = await hashPassword(password);
        await client.query(
          'UPDATE operator_accounts SET password_hash = $2, auth_version = auth_version + 1 WHERE id = $1',
          [account.id, hash],
        );
        await client.query('DELETE FROM operator_password_resets WHERE account_id = $1', [
          account.id,
        ]);
        await appendAudit(client, {
          event: 'account.password_reset',
          actor: account.id,
          detail: { account_id: account.id },
        });
      });
      return { status: 'OK' };
    },

    /**
     * Deliver up to twenty queued recovery messages, retaining the same token on retry.
     * @param accountId - Optional account identifier; tokens remain in PostgreSQL.
     * @returns Completion of this bounded delivery pass.
     * @throws Database errors that prevent queue access or safe failure bookkeeping.
     * @remarks Provider rejection is retried after a cooldown and reported without
     * message details. A lost DB commit can duplicate an email, but never a reset token.
     */
    async deliver(accountId?: number) {
      let failed = false;
      const { rows } = await database.query<{
        account_id: number;
        token_digest: Buffer;
      }>(
        `SELECT r.account_id, r.token_digest
        FROM operator_password_resets r JOIN operator_accounts a ON a.id = r.account_id
        WHERE ($1::int IS NULL OR r.account_id=$1) AND ${eligibleAccount} AND r.auth_version = a.auth_version AND r.email = a.email
          AND r.expires_at > clock_timestamp() AND (r.delivered_at IS NULL OR r.delivered_at < r.requested_at)
          AND (r.attempted_at IS NULL OR r.attempted_at < clock_timestamp() - interval '1 minute')
        ORDER BY r.requested_at LIMIT 20`,
        [accountId ?? null],
      );
      for (const row of rows) {
        try {
          await transaction(database, async (client) => {
            const account = await accountForReset(client, row.account_id);
            if (!account) return;
            const challenge = (
              await client.query<RecoveryChallenge>(
                `SELECT * FROM operator_password_resets
              WHERE account_id = $1 AND auth_version = $2 AND email = $3 AND expires_at > clock_timestamp()
                AND token_digest=$4
                AND (delivered_at IS NULL OR delivered_at < requested_at)
                AND (attempted_at IS NULL OR attempted_at < clock_timestamp() - interval '1 minute')
              FOR UPDATE SKIP LOCKED`,
                [account.id, account.auth_version, account.email, row.token_digest],
              )
            ).rows[0];
            if (!challenge) return;
            const token = bearer(challenge);
            if (!timingSafeEqual(digest(token), challenge.token_digest))
              throw new Error('Recovery key does not match pending state.');
            await sendMail({
              to: challenge.email,
              url: new URL('/password_reset/#' + token, origin).href,
              expiresAt: challenge.expires_at,
              purpose: challenge.purpose,
              ...(challenge.purpose === 'activation' ? { username: account.username } : {}),
            });
            await client.query(
              `UPDATE operator_password_resets SET delivered_at = clock_timestamp(),
              attempted_at = clock_timestamp(), attempts = attempts + 1 WHERE account_id = $1 AND token_digest=$2`,
              [account.id, challenge.token_digest],
            );
          });
        } catch {
          failed = true;
          await database.query(
            'UPDATE operator_password_resets SET attempted_at = clock_timestamp(), attempts = attempts + 1 WHERE account_id = $1 AND token_digest = $2',
            [row.account_id, row.token_digest],
          );
          reportDeliveryError();
        }
      }
      await purgeExpired();
      if (accountId && failed) throw new Error('Recovery mail delivery unavailable.');
    },
  };
}
