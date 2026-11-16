/** Allows three ten-second cold KMS operations plus database lookup and HTTP overhead. */
export const protectedReadProbeTimeoutMs = 45_000;

/**
 * Read a complete installation GET response without retaining a keep-alive connection.
 * @param url - Test-owned HTTP endpoint.
 * @param headers - Optional request headers, including the installation bearer.
 * @param timeoutMs - End-to-end probe budget; defaults to ten seconds for readiness probes.
 * @returns The received HTTP status after consuming the entire response body.
 * @throws Error identifying the probe path, with the fetch failure retained as its cause,
 * for unavailable endpoints, truncated responses or expiry of the probe budget.
 * @remarks Service restarts and blocking setup commands can outlive pooled sockets.
 * These probes close their connection after each response. HTTP failures and transport
 * errors are never retried; callers must assert the exact expected status.
 */
export async function installationStatus(
  url: string,
  headers?: HeadersInit,
  timeoutMs = 10_000,
): Promise<number> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('connection', 'close');
  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer();
    return response.status;
  } catch (cause) {
    throw new Error('Installation HTTP probe failed for ' + new URL(url).pathname + '.', {
      cause,
    });
  }
}
