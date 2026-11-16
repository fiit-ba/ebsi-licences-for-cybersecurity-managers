import { createHash } from 'node:crypto';
import { VerificationStop } from './outcomes.ts';

/**
 * Reconstruct the existing JWT-VC SD claims without inventing a key-binding JWT.
 * @param token - Signed JWT with the holder-selected disclosure suffix.
 * @param payload - Decoded issuer-signed claims.
 * @returns Revealed claims, retaining only attributes actually presented.
 * @throws VerificationStop with INVALID_SIGNATURE for malformed or unmatched disclosures.
 */
export function revealDisclosures(token: string, payload: Record<string, any>) {
  const parts = token.trim().split('~').slice(1);
  if (parts.length && parts.at(-1))
    refuse('A key-binding JWT is not expected after the disclosures');
  const disclosures = parts.filter(Boolean);
  if (disclosures.length && (payload._sd_alg ?? 'sha-256') !== 'sha-256')
    refuse(`Unsupported _sd_alg ${payload._sd_alg}`);
  const pending = new Map<string, [string, unknown]>();
  for (const value of disclosures) {
    const digest = createHash('sha256').update(value).digest('base64url');
    if (pending.has(digest)) refuse('A disclosure is given twice');
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
      refuse('A disclosure is not base64url-encoded JSON');
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    )
      refuse('A disclosure is not [salt, name, value]');
    if (['_sd', '...', '_sd_alg'].includes(decoded[1]))
      refuse(`A disclosure may not be named ${decoded[1]}`);
    pending.set(digest, [decoded[1], decoded[2]]);
  }
  const used = new Set<string>();
  /**
   * Reconstruct nested object disclosures, refusing reuse and collisions.
   * @param node - Signed JSON subtree.
   * @returns The subtree with matching claims restored and SD metadata removed.
   * @throws VerificationStop for unsupported arrays, duplicate digests or claim collisions.
   */
  function walk(node: any): any {
    if (Array.isArray(node)) {
      if (node.some((item) => item && typeof item === 'object' && Object.hasOwn(item, '...')))
        refuse('Array element disclosures are not supported');
      return node.map(walk);
    }
    if (!node || typeof node !== 'object') return node;
    const out = new Map(
      Object.entries(node)
        .filter(([name]) => !['_sd', '_sd_alg'].includes(name))
        .map(([name, value]) => [name, walk(value)]),
    );
    const digests = node._sd || [];
    if (!Array.isArray(digests)) refuse('_sd is not a list');
    for (const digest of digests) {
      const found = pending.get(digest);
      if (!found) continue;
      if (used.has(digest)) refuse('A digest is signed twice');
      const [name, value] = found;
      if (out.has(name)) refuse(`${name} is disclosed and signed in clear at once`);
      used.add(digest);
      out.set(name, walk(value));
    }
    return Object.fromEntries(out);
  }
  const revealed = walk(payload);
  if (used.size !== pending.size) refuse('A disclosure matches nothing the issuer signed');
  return revealed;
}

/**
 * Report a disclosure failure in the credential-result category.
 * @param reason - Specific protocol-compatible explanation.
 * @returns Never returns.
 * @throws VerificationStop for invalid selective disclosure.
 */
function refuse(reason: string): never {
  throw new VerificationStop('INVALID_SIGNATURE', reason, 'disclosures_valid');
}
