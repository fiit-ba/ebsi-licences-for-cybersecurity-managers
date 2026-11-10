/**
 * Create schema access constrained to one configured TSR base.
 *
 * @param baseUrl - Trusted HTTP(S) registry base without credentials/query/fragment.
 * @param fetchSchema - Fetch implementation; defaults to global fetch.
 * @returns Address generation, bounded document loading and existence checks.
 * @throws Error or TypeError for an invalid base URL.
 */
export function trustedSchemaRegistry(baseUrl: string, fetchSchema = fetch) {
  const base = new URL(baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      'PLR_TSR_URL must be an HTTP(S) registry base URL without credentials, query or fragment.',
    );
  }
  /**
   * Build a schema URL under the configured registry.
   *
   * @param id - Registry schema identifier.
   * @returns The encoded schema address.
   */
  const address = (id: string) =>
    base.href.replace(/\/+$/, '') + '/schemas/' + encodeURIComponent(id);

  /**
   * Load one bounded JSON schema from an exact trusted-registry address.
   *
   * @param reference - Full schema URL beneath the configured base.
   * @returns The parsed schema object.
   * @throws Error for untrusted reference, failed HTTP, missing/oversized body or invalid object;
   * transport and JSON errors.
   */
  async function document(reference: string) {
    const prefix = base.href.replace(/\/+$/, '') + '/schemas/';
    if (
      typeof reference !== 'string' ||
      !reference.startsWith(prefix) ||
      !/^[A-Za-z0-9._-]{1,200}$/.test(reference.slice(prefix.length)) ||
      ['.', '..'].includes(reference.slice(prefix.length))
    ) {
      throw new Error('The credential schema URL is outside the configured TSR.');
    }
    const response = await fetchSchema(reference, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('The TSR schema is unavailable.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The TSR schema document is empty.');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) {
          await reader.cancel();
          throw new Error('The TSR schema document is too large.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The TSR response is not a schema document.');
    }
    return payload;
  }

  return {
    address,
    document,
    /**
     * Check whether the registry can supply a schema document.
     *
     * @param id - Registry schema identifier.
     * @returns True on successful document load; false for any load failure.
     */
    async contains(id: string) {
      try {
        await document(address(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
