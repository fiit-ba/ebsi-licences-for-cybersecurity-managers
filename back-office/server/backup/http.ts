import type { IncomingMessage, ServerResponse } from 'node:http';
import { send } from '../http/response.ts';
import { backupJson, BackupRefused } from './proof.ts';
import { backupTooLarge, type postgresWalletBackups } from './service.ts';

/** Signed public backup adapter dependencies, independent of operator authentication. */
export interface BackupHttpOptions {
  backups: ReturnType<typeof postgresWalletBackups>;
  throttle: (address: string) => Promise<number | null>;
  address: (request: IncomingMessage) => string;
}

/**
 * Read the JSON envelope outside the ordinary API body limit.
 * @param request - Incoming upload or deletion stream.
 * @param maxBytes - Ciphertext limit; envelope receives another 64 KiB.
 * @returns Parsed JSON with exact integer tokens.
 * @throws BackupRefused for oversized bodies; SyntaxError for malformed JSON; stream errors.
 */
async function input(request: IncomingMessage, maxBytes: number) {
  const limit = maxBytes + 64 * 1024;
  if (Number(request.headers['content-length'] ?? 0) > limit) {
    request.resume();
    throw backupTooLarge(maxBytes);
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw backupTooLarge(maxBytes);
    }
    chunks.push(chunk);
  }
  if (!length) return {};
  return backupJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

/**
 * Compose the anonymous backup route with original parsing and per-address throttling.
 * @param options - Storage, weighted-window admission and trusted address resolver.
 * @returns Handler reporting whether it owned the route after sending its response.
 * @throws Unexpected storage or stream errors for the shared HTTP failure boundary.
 * @remarks No operator token is read and no request payload is logged.
 */
export function walletBackupHttp(options: BackupHttpOptions) {
  /**
   * Dispatch one original backup route before operator authentication.
   * @param request - Incoming holder HTTP request.
   * @param response - Response receiving the original JSON result.
   * @param path - Request pathname without query parameters.
   * @returns Whether the request matched the backup route.
   * @throws Unexpected storage/stream errors for the outer HTTP failure boundary.
   */
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> {
    const id = /^\/wallet-backups\/([A-Za-z0-9_-]{43})\/$/.exec(path)?.[1];
    if (!id) return false;
    const retry = await options.throttle(options.address(request));
    if (retry) {
      response.setHeader('retry-after', String(retry));
      send(response, 429, {
        detail: `Request was throttled. Expected available in ${retry} ${retry === 1 ? 'second' : 'seconds'}.`,
      });
      return true;
    }
    response.setHeader('allow', 'GET, PUT, DELETE, HEAD, OPTIONS');
    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const body = await options.backups.read(id);
        send(response, body ? 200 : 404, body ?? { detail: 'No backup', reason: 'NoBackup' });
      } else if (request.method === 'PUT' || request.method === 'DELETE') {
        if (
          request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
            'application/json' &&
          (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'])
        ) {
          send(response, 415, {
            detail: `Unsupported media type "${request.headers['content-type'] ?? ''}" in request.`,
          });
          return true;
        }
        let body;
        try {
          body = await input(request, options.backups.maxBytes);
        } catch (error) {
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
          send(response, 400, { detail: 'The upload is not JSON' });
          return true;
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new Error('Backup input is not an object');
        if (request.method === 'PUT') send(response, 200, await options.backups.store(id, body));
        else
          send(
            response,
            (await options.backups.remove(id, String(body.proof ?? ''))) ? 204 : 404,
            undefined,
          );
      } else if (request.method === 'OPTIONS') {
        send(response, 200, {
          name: 'Backup',
          description: '',
          renders: ['application/json', 'text/html'],
          parses: ['application/json'],
        });
      } else send(response, 405, { detail: `Method "${request.method}" not allowed.` });
    } catch (error) {
      if (!(error instanceof BackupRefused)) throw error;
      send(response, error.status, { detail: error.message, reason: error.reason, ...error.extra });
    }
    return true;
  }

  return handle;
}
