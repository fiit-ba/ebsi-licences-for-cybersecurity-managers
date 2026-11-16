import { createHash, createPublicKey, verify } from 'node:crypto';

/** Original wallet proof media type; encryption belongs exclusively to the Wallet. */
export const proofType = 'plr-wallet-backup+jwt';

/** Verified public backup key, with no holder identity or private material. */
export type BackupKey = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

/** Backup refusal, including its public reason, message and HTTP status. */
export class BackupRefused extends Error {
  status: number;
  reason: string;
  extra: Record<string, unknown>;

  /**
   * Construct a refusal that is safe to disclose through the backup API.
   * @param reason - Original machine-readable reason.
   * @param detail - Original public explanation.
   * @param status - HTTP status, default 400.
   * @param extra - Additional public fields, such as the kept version.
   */
  constructor(reason: string, detail: string, status = 400, extra = {}) {
    super(detail);
    this.reason = reason;
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Parse JSON with exact integer versions; decimal and exponent tokens remain noninteger representations.
 * @param text - UTF-8 JSON document.
 * @returns Parsed data, with integer tokens represented by bigint.
 * @throws SyntaxError for malformed JSON.
 */
export function backupJson(text: string): any {
  return JSON.parse(text, (_key: string, value: any, context?: { source?: string }) => {
    const raw = (context as { source?: string } | undefined)?.source;
    return typeof value === 'number' && raw && /^-?\d+$/.test(raw) ? BigInt(raw) : value;
  });
}

/**
 * Emit a PostgreSQL bigint as an exact JSON number, without losing integer precision.
 * @param value - Integer version as database text or bigint.
 * @returns A raw JSON numeric value accepted by JSON.stringify.
 */
export function versionJson(value: string | bigint): unknown {
  return (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON(String(value));
}

/**
 * Hash the base64url text itself, rather than its decoded bytes.
 * @param ciphertext - Opaque Wallet envelope.
 * @returns SHA-256 base64url digest used by the original proof.
 */
export function backupDigest(ciphertext: string): string {
  return createHash('sha256').update(ciphertext).digest('base64url');
}

/**
 * Verify the ES256 proof, registered claims and backup key binding.
 * @param proof - Compact JWS supplied by the holder.
 * @param id - Backup key thumbprint in the route.
 * @param storedKey - Persisted verification key, absent on first upload.
 * @param now - Current epoch seconds, supplied only for deterministic checks.
 * @returns Verified claims and the verified public key separately from untrusted claims.
 * @throws BackupRefused for malformed, mismatched, stale or incorrectly signed proofs.
 * @remarks Header keys on existing backups are ignored. A payload named key cannot
 * replace the verified public key used for signature validation.
 */
export function verifyBackupProof(
  proof: string,
  id: string,
  storedKey?: BackupKey,
  now = Date.now() / 1000,
) {
  let header: any;
  let parts: string[];
  try {
    parts = proof.split('.');
    if (parts.length !== 3) throw new Error();
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error();
  } catch {
    throw new BackupRefused('InvalidProof', 'The proof is not a JWS');
  }
  if (header.alg !== 'ES256' || header.typ !== proofType)
    throw new BackupRefused('InvalidProof', `The proof must be an ES256 ${proofType}`);

  let key = storedKey;
  if (!key) {
    const jwk = header.jwk;
    if (
      !jwk ||
      typeof jwk !== 'object' ||
      Array.isArray(jwk) ||
      jwk.kty !== 'EC' ||
      jwk.crv !== 'P-256' ||
      'd' in jwk
    )
      throw new BackupRefused('InvalidProof', "A new backup's proof carries its P-256 public key");
    if (!('x' in jwk) || !('y' in jwk))
      throw new BackupRefused('InvalidProof', 'The public key is incomplete');
    key = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    const thumbprint = backupDigest(
      JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }),
    );
    if (thumbprint !== id)
      throw new BackupRefused('NotYourBackup', "The backup's address is its key's thumbprint", 403);
  }

  let claims: any;
  try {
    const publicKey = createPublicKey({ key, format: 'jwk' });
    if (
      !verify(
        'sha256',
        Buffer.from(parts.slice(0, 2).join('.')),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(parts[2], 'base64url'),
      )
    )
      throw new Error();
    claims = backupJson(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (
      !claims ||
      typeof claims !== 'object' ||
      Array.isArray(claims) ||
      !('iat' in claims) ||
      claims.iat === null
    )
      throw new Error();
    // Validate exp/nbf without leeway, reject nonempty aud without an audience,
    // and require string sub/jti when those optional claims are present.
    for (const name of ['exp', 'nbf']) {
      if (!(name in claims)) continue;
      const value = claims[name];
      if (value === null || (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim())))
        throw new Error();
      const timestamp = Math.trunc(Number(value));
      if (!Number.isFinite(timestamp) || (name === 'exp' ? timestamp <= now : timestamp > now))
        throw new Error();
    }
    if (claims.aud && (!Array.isArray(claims.aud) || claims.aud.length)) throw new Error();
    if (['sub', 'jti'].some((name) => name in claims && typeof claims[name] !== 'string'))
      throw new Error();
  } catch {
    throw new BackupRefused('InvalidProof', "The proof's signature does not verify", 403);
  }
  const iat = claims.iat;
  if (!['bigint', 'boolean'].includes(typeof iat) || Math.abs(now - Number(iat)) > 900)
    throw new BackupRefused('StaleProof', 'The proof was not made just now');
  if (claims.backup !== id)
    throw new BackupRefused('InvalidProof', 'The proof is for another backup');
  return { key, claims };
}
