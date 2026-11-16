import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';

const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const jwkCodec = Buffer.from([0xd1, 0xd6, 0x03]); // Unsigned varint for 0xeb51.

/**
 * Decode the canonical EBSI P-256 JWK did:key representation.
 *
 * @param did - Untrusted holder DID.
 * @returns The public JWK, or undefined for unsupported or noncanonical keys.
 * @throws SyntaxError if a codec-matching key contains malformed JSON.
 */
export function decodeHolderKey(did: unknown) {
  if (typeof did !== 'string' || !/^did:key:z[1-9A-HJ-NP-Za-km-z]{1,256}$/.test(did)) return;
  let number = 0n;
  for (const digit of did.slice('did:key:z'.length))
    number = number * 58n + BigInt(base58.indexOf(digit));
  const hex = number.toString(16);
  const bytes = Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex');
  if (!bytes.subarray(0, jwkCodec.length).equals(jwkCodec) || did.startsWith('did:key:z1')) return;

  const encoded = bytes.subarray(jwkCodec.length);
  const { crv, kty, x, y } = JSON.parse(encoded.toString('utf8'));
  if (
    crv !== 'P-256' ||
    kty !== 'EC' ||
    ![x, y].every(
      (value) =>
        typeof value === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(value) &&
        Buffer.from(value, 'base64url').toString('base64url') === value,
    )
  )
    return;
  const key = { crv, kty, x, y };
  if (encoded.equals(Buffer.from(JSON.stringify(key)))) return key;
}

/**
 * Verify a holder JWT against its embedded public did:key.
 *
 * @param jwt - Untrusted compact JWT.
 * @param options - Expected audience, JWT type, maximum age and optional verification clock.
 * @returns The holder DID and verified payload, or undefined for any verification failure.
 */
export async function verifyDidKeyJwt(
  jwt: string,
  options: { audience: string; typ: string; now?: Date; maxAge: number },
) {
  const { audience, typ, now, maxAge } = options;

  try {
    const { iss: did } = decodeJwt(jwt);
    const jwk = decodeHolderKey(did);
    if (!jwk) return;
    const { kid } = decodeProtectedHeader(jwt);
    if (kid !== did && kid !== did + '#' + did!.slice('did:key:'.length)) return;
    const key = await importJWK(jwk, 'ES256');
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ['ES256'],
      typ,
      issuer: did,
      audience,
      requiredClaims: ['iat', 'exp', 'nonce'],
      maxTokenAge: maxAge,
      clockTolerance: 5,
      currentDate: now,
    });
    if (payload.exp! <= payload.iat! || payload.exp! > payload.iat! + maxAge + 5) return;
    return { did, payload };
  } catch {
    return undefined;
  }
}

/**
 * Validate an OpenID4VCI 1.0 `jwt` key proof and name the key it binds the credential to.
 *
 * @param jwt - Untrusted proof JWT from `proofs.jwt`.
 * @param audience - This Credential Issuer's identifier.
 * @returns The holder's did:key and the proof's c_nonce, or undefined for any failure.
 * @remarks The key is named by `kid`, a DID URL of an EBSI natural-person did:key; `jwk` and
 * `x5c` are not accepted. Pre-authorized access is anonymous, so `iss` must be absent.
 */
export async function verifiedKeyProof(jwt: unknown, audience: string) {
  if (typeof jwt !== 'string' || jwt.length > 4096) return;
  try {
    const header = decodeProtectedHeader(jwt);
    if (header.typ !== 'openid4vci-proof+jwt' || header.alg !== 'ES256' || header.jwk || header.x5c)
      return;
    const kid = header.kid;
    if (typeof kid !== 'string') return;
    const did = kid.split('#')[0];
    const jwk = decodeHolderKey(did);
    if (!jwk || (kid !== did && kid !== did + '#' + did.slice('did:key:'.length))) return;
    const { payload } = await jwtVerify(jwt, await importJWK(jwk, 'ES256'), {
      algorithms: ['ES256'],
      typ: 'openid4vci-proof+jwt',
      audience,
      requiredClaims: ['iat', 'nonce'],
      maxTokenAge: 300,
      clockTolerance: 5,
    });
    if (payload.iss !== undefined || typeof payload.nonce !== 'string') return;
    return { did, nonce: payload.nonce };
  } catch {
    return undefined;
  }
}
