import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/**
 * Resolve the client address using only the explicitly configured trusted proxy tail.
 * @param request - Request carrying the direct socket address and optional forwarded chain.
 * @param trustedProxyHops - Trusted ingress hops appending to X-Forwarded-For; zero ignores it.
 * @returns A canonical address or the direct-peer fallback for malformed/short chains.
 * @throws Error for an invalid trusted-hop configuration.
 * @remarks The deployment must prevent direct untrusted access when forwarding
 * headers are enabled. Request headers never choose the configured number of hops.
 */
export function clientAddress(request: IncomingMessage, trustedProxyHops = 0): string {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 8) {
    throw new Error('Configure zero to eight trusted proxy hops.');
  }
  const peer = request.socket.remoteAddress ?? 'unknown';
  const header = request.headers['x-forwarded-for'];
  if (!trustedProxyHops || !header) return peer;
  const chain = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((value) => value.trim());
  if (chain.length < trustedProxyHops || chain.some((value) => !isIP(value))) return peer;
  const address = chain[chain.length - trustedProxyHops];
  return isIP(address) === 6 ? new URL(`http://[${address}]`).hostname.slice(1, -1) : address;
}
