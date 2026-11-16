/**
 * `fetch`, given up after `ms` - or when `signal` aborts - with `read` taking
 * what it needs from the response inside the same time.
 */
export const fetchWithin = async <T>(
  url: string,
  init: RequestInit,
  ms: number,
  read: (response: Response) => Promise<T> | T,
  signal?: AbortSignal,
): Promise<T> => {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), ms)
  signal?.addEventListener?.('abort', () => timeout.abort())
  try {
    return await read(await fetch(url, { ...init, signal: timeout.signal }))
  } finally {
    clearTimeout(timer)
  }
}
