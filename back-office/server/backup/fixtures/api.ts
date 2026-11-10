import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { backOfficeServer } from '../../http/app.ts';
import { postgresAccounts } from '../../identity/auth/accounts.ts';
import { operatorTokens } from '../../identity/auth/tokens.ts';
import { postgresWalletBackups } from '../service.ts';
import { postgresBackupThrottle } from '../throttle.ts';
import { walletBackupHttp } from '../http.ts';
import { clientAddress } from '../../http/client-address.ts';
import { backupDigest, proofType } from '../proof.ts';

/**
 * Create a real P-256 holder with flexible signed negative-test claims.
 * @returns Test holder key, address and proof/upload factories.
 */
export function backupHolder() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  const jwk = { kty, crv, x, y };
  const id = backupDigest(JSON.stringify({ crv, kty, x, y }));
  /**
   * Sign protocol-format claims, optionally substituting invalid headers or another key.
   * @param claims - Payload overrides for refusal cases.
   * @param header - Header overrides for proof validation cases.
   * @param key - Actual signing key, default the holder's key.
   * @returns Compact ES256 JWS with raw R/S signature.
   */
  const proof = (claims: object = {}, header: object = {}, key = privateKey) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input =
      encode({ alg: 'ES256', typ: proofType, jwk, ...header }) +
      '.' +
      encode({ backup: id, iat: Math.floor(Date.now() / 1000), ...claims });
    return (
      input +
      '.' +
      sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    );
  };
  return {
    id,
    jwk,
    privateKey,
    proof,
    upload: (ciphertext = 'c2VjcmV0', version = 1, claims: object = {}) => ({
      ciphertext,
      version,
      proof: proof({ version, digest: backupDigest(ciphertext), ...claims }),
    }),
  };
}

/**
 * Start the real application HTTP dispatcher against an explicitly disposable database.
 * @param options - Ciphertext size, throttle rate, deterministic clock and trusted hops.
 * @returns Real request helper, database and owned listener cleanup.
 * @throws Configuration, database and listener failures.
 */
export async function backupApi(
  options: { maxBytes?: number; rate?: string; clock?: () => number; hops?: number } = {},
) {
  if (process.env.PGDATABASE !== 'atest_back_office_test')
    throw new Error('Use a disposable test database');
  const database = new pg.Pool();
  const secret = 'backup-tests-only-private-limiter-key';
  const throttle = postgresBackupThrottle(
    database,
    secret,
    options.rate ?? '100000/min',
    options.clock,
  );
  const errors: unknown[] = [];
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens: operatorTokens(secret),
    walletBackups: walletBackupHttp({
      backups: postgresWalletBackups(database, options.maxBytes),
      throttle,
      address: (request) => clientAddress(request, options.hops ?? 0),
    }),
    reportError: (error) => errors.push(error),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    database,
    origin,
    errors,
    server,
    throttle,
    /**
     * Send a real HTTP request with an optional exact raw body.
     * @param id - Backup route address.
     * @param method - HTTP method.
     * @param body - Optional JSON or raw text.
     * @param headers - Additional request headers.
     * @returns Status, parsed JSON/text and headers from the real listener.
     */
    async call(
      id: string,
      method = 'GET',
      body?: object | string,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(`${origin}/wallet-backups/${id}/`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body:
          typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = text;
      }
      return { status: response.status, body: value, headers: response.headers };
    },
    /**
     * Close only this fixture's listener and pool; no data or audit history is cleared.
     * @returns Completion after listener and pool shutdown.
     */
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.end();
    },
  };
}
