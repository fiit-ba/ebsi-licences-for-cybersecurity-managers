import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { BoundCredentialRefusal, CredentialVerificationError } from './credential.ts';
import type { AssertionKeyResolver } from '../issuance/types.ts';
import type { CredentialStatusEntry } from './types.ts';

const unzip = promisify(gunzip);
const maxBytes = 256 * 1024;
const formats = new Map([
  ['StatusList2021Entry', { credential: 'StatusList2021Credential', subject: 'StatusList2021' }],
  [
    'BitstringStatusListEntry',
    {
      credential: 'BitstringStatusListCredential',
      subject: 'BitstringStatusList',
      multibase: true,
    },
  ],
]);

/**
 * Build the refusal for unavailable or unverifiable historical status.
 *
 * @returns A CredentialVerificationError with LegacyStatusUnavailable.
 */
function unavailable() {
  return new CredentialVerificationError('LegacyStatusUnavailable');
}

/**
 * Read a bounded compact JWT from a status-list response.
 *
 * @param response - HTTP response whose body is consumed.
 * @returns Compact status-list JWT.
 * @throws CredentialVerificationError for unavailable/oversized/invalid responses; body or JSON
 * decoding errors.
 */
async function readJwt(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw unavailable();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw unavailable();
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  const jwt = text.startsWith('"') ? JSON.parse(text) : text;
  if (typeof jwt !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) {
    throw unavailable();
  }
  return jwt;
}

/**
 * Create historical status checks restricted to exact configured list URLs.
 *
 * @param options - Issuer assertion-key resolver, allowed list identities and optional fetch
 * implementation.
 * @returns A verifier for signed one-bit suspension/revocation list entries.
 * @throws Error for invalid list URL or issuer configuration.
 */
export function legacyStatusVerifier(options: {
  assertionKey: AssertionKeyResolver;
  allowedLists: { url: string; issuer: string; credentialId?: string }[];
  fetchList?: typeof fetch;
}) {
  const { assertionKey, allowedLists, fetchList = fetch } = options;

  const allowed = new Map(
    allowedLists.map(({ url, issuer, credentialId = url }) => {
      const address = new URL(url);
      if (
        address.protocol !== 'https:' ||
        address.href !== url ||
        address.username ||
        address.password ||
        address.hash ||
        typeof issuer !== 'string' ||
        !issuer ||
        typeof credentialId !== 'string' ||
        !credentialId
      ) {
        throw new Error(
          'A legacy status list must be an exact HTTPS URL with a configured issuer.',
        );
      }
      return [url, { issuer, credentialId }];
    }),
  );

  /**
   * Verify a signed status list and read the requested bounded bit.
   *
   * @param entry - Credential status-list entry.
   * @param issuer - Expected issuer DID.
   * @param now - Verification clock.
   * @returns Whether the referenced status bit is set.
   * @throws CredentialVerificationError for unsupported, unavailable, invalid or mismatched lists.
   */
  async function isSet(entry: CredentialStatusEntry, issuer: string, now: Date) {
    const format = formats.get(entry?.type);
    const {
      statusListCredential: url,
      statusPurpose: purpose,
      statusListIndex: index,
    } = entry ?? {};
    const list = allowed.get(url!) as { issuer: string; credentialId: string } | undefined;
    if (
      !format ||
      !list ||
      list.issuer !== issuer ||
      !['revocation', 'suspension'].includes(purpose!) ||
      typeof index !== 'string' ||
      !/^(0|[1-9]\d{0,8})$/.test(index) ||
      (entry.statusSize !== undefined && entry.statusSize !== 1)
    )
      throw unavailable();

    try {
      const response = await fetchList(url!, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const jwt = await readJwt(response);
      const { kid } = decodeProtectedHeader(jwt);
      if (typeof kid !== 'string' || !kid.startsWith(issuer + '#')) throw unavailable();
      const unsigned = decodeJwt(jwt);
      const credential = unsigned.vc as { issuanceDate?: unknown; issued?: unknown } | undefined;
      const issuedAt = credential?.issuanceDate ?? credential?.issued;
      if (issuedAt !== undefined && typeof issuedAt !== 'string') throw unavailable();
      const at = typeof issuedAt === 'string' ? new Date(issuedAt) : undefined;
      if (at && (!Number.isFinite(+at) || +at < 0 || +at > +now + 5_000)) throw unavailable();
      const jwk = await assertionKey(issuer, kid, at);
      const { payload } = await jwtVerify(jwt, await importJWK(jwk, 'ES256'), {
        algorithms: ['ES256'],
        issuer,
        currentDate: now,
      });
      const vc = payload.vc as {
        issuer?: string;
        id?: string;
        type?: string[];
        validFrom?: string;
        issuanceDate?: string;
        validUntil?: string;
        expirationDate?: string;
        credentialSubject?: {
          type?: string;
          statusPurpose?: string | string[];
          encodedList?: string;
        };
      };
      const subject = vc?.credentialSubject;
      const purposes = Array.isArray(subject?.statusPurpose)
        ? subject.statusPurpose
        : [subject?.statusPurpose];
      const from = vc?.validFrom ?? vc?.issuanceDate;
      const until = vc?.validUntil ?? vc?.expirationDate;
      if (
        vc?.issuer !== issuer ||
        vc.id !== list.credentialId ||
        !Array.isArray(vc.type) ||
        !vc.type.includes(format.credential) ||
        subject?.type !== format.subject ||
        !purposes.includes(purpose!) ||
        (from != null && !(Date.parse(from) <= +now)) ||
        (until != null && !(Date.parse(until) > +now))
      ) {
        throw unavailable();
      }
      // Some legacy proxy URLs differ from the ID signed into the list.
      // Configuration can pin the separate signed ID in that case.
      const encoded = subject!.encodedList;
      if (typeof encoded !== 'string') throw unavailable();
      const compressed = format.multibase
        ? /^u[A-Za-z0-9_-]+$/.test(encoded) && Buffer.from(encoded.slice(1), 'base64url')
        : /^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded) && Buffer.from(encoded, 'base64');
      if (!compressed) throw unavailable();
      const bytes = await unzip(compressed, { maxOutputLength: 2 * 1024 * 1024 });
      const offset = Number(index);
      if ((format.multibase && bytes.length < 16 * 1024) || offset >= bytes.length * 8)
        throw unavailable();
      return Boolean(bytes[Math.floor(offset / 8)] & (0x80 >> (offset % 8)));
    } catch {
      throw unavailable();
    }
  }

  /**
   * Check allowed historical status entries, prioritizing revocation.
   *
   * @param entries - One or two distinct-purpose status entries.
   * @param issuer - Expected credential issuer.
   * @param now - Verification clock; defaults to now.
   * @returns Completion when no applicable suspension or revocation bit is set.
   * @throws CredentialVerificationError when status cannot be established; BoundCredentialRefusal
   * when revoked or suspended.
   */
  async function verifyLegacyStatus(
    entries: CredentialStatusEntry[],
    issuer: string,
    now = new Date(),
  ) {
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.length > 2 ||
      new Set(entries.map((entry) => entry?.statusPurpose)).size !== entries.length
    )
      throw unavailable();
    let suspended = false;
    for (const entry of entries) {
      if (!(await isSet(entry, issuer, now))) continue;
      if (entry.statusPurpose === 'revocation')
        throw new BoundCredentialRefusal('Revoked', 'REVOKED');
      suspended = true;
    }
    if (suspended) throw new BoundCredentialRefusal('Suspended', 'SUSPENDED');
  }
  return verifyLegacyStatus;
}
