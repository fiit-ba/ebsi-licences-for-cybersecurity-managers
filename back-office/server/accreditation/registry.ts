/** Public TIR attribute metadata, retaining its identifier for exact chain validation. */
export type IssuerAttribute = Record<string, unknown> & { id: string };

/**
 * Read a bounded TIR collection (EBSI Core API v1) through configured registry addresses.
 * @param tirUrl - Trusted TIR base.
 * @param did - Requested issuer DID.
 * @param request - HTTP transport.
 * @returns Attribute metadata with stable identifiers, or an empty list for an unknown issuer.
 * @throws Error for unavailable, malformed or oversized registry responses.
 */
export async function issuerAttributes(
  tirUrl: string,
  did: string,
  request = fetch,
): Promise<IssuerAttribute[]> {
  const base = `${tirUrl.replace(/\/$/, '')}/issuers/${encodeURIComponent(did)}/attributes`;
  const attributes: IssuerAttribute[] = [];
  let url = base;
  const visited = new Set<string>();
  while (!visited.has(url)) {
    if (visited.size >= 20) throw new Error('Too many TIR pages.');
    visited.add(url);
    const response = await request(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error('TIR collection unavailable.');
    const page = await response.json();
    if (!Array.isArray(page.items) || page.items.length > 100)
      throw new Error('Invalid TIR collection.');
    for (const item of page.items) {
      if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(item.id))
        throw new Error('Invalid TIR attribute identifier.');
      const record = await request(`${base}/${item.id}`, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!record.ok) throw new Error('TIR attribute unavailable.');
      const value = await record.json();
      if (value.did !== did || !value.attribute || typeof value.attribute !== 'object')
        throw new Error('Invalid TIR attribute.');
      attributes.push({ ...value.attribute, id: item.id });
    }
    const next = page.links?.next;
    if (!next || next === url || next === base) break;
    const parsed = new URL(next, base);
    const collection = new URL(base);
    if (
      parsed.origin !== collection.origin ||
      decodeURIComponent(parsed.pathname) !== decodeURIComponent(collection.pathname)
    )
      throw new Error('Invalid TIR page link.');
    // EBSI may spell the same DID with literal colons in its links. Keep the
    // configured collection and accept only the page query from that link.
    collection.search = parsed.search;
    if (collection.href === url || collection.href === base) break;
    if (visited.has(collection.href)) throw new Error('Cyclic TIR pagination.');
    url = collection.href;
  }
  return attributes;
}
