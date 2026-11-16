import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './body.ts';
import { send } from './response.ts';

/**
 * Connect the console's existing same-origin RPC path to its configured ledger.
 * @param target - Fixed deployment RPC URL; never selected from request input.
 * @returns An HTTP dispatcher that reports whether it handled the request.
 * @throws Error for an invalid target URL; request/response stream errors.
 * @remarks For hosted installations the staff edge owns this path. No credentials or
 * forwarding headers from the browser are sent to the ledger.
 */
export function consoleLedgerProxy(target: string) {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Configure a plain HTTP(S) ledger RPC URL.');
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.split('?')[0] !== '/api-ledger') return false;
    if (request.method !== 'POST') {
      send(response, 405, { detail: 'Expected POST.' });
      return true;
    }
    const body = await readBody(request, 'application/json', 1024 * 1024);
    if (body.status) {
      send(response, body.status, body.body);
      return true;
    }
    try {
      const result = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body.text,
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      const text = await result.text();
      if (text.length > 4 * 1024 * 1024) throw new Error('Oversized RPC response.');
      const parsed = JSON.parse(text);
      send(response, result.status, parsed);
    } catch {
      send(response, 502, { detail: 'Ledger unavailable.' });
    }
    return true;
  };
}
