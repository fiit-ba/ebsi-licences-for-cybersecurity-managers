import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';
import { KeyObject, sign } from 'node:crypto';
import type { AuthorizationSigning } from '../types.ts';

/**
 * Provide a registry authorization signing key for protocol contract tests without KMS transport.
 * @returns ES256 token signing and matching public JWKS.
 * @throws Key generation, export and thumbprint errors.
 */
export async function authorizationFixture(): Promise<AuthorizationSigning> {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return {
    /**
     * Return the test registry's active token key.
     * @returns Public key and signature operation backed by its ephemeral private key.
     */
    async key() {
      return {
        kid: 'did:ebsi:zRegistry#' + kid,
        publicJwk,
        /**
         * Sign the exact registry JWT input bytes.
         * @param input - Protected header and payload bytes.
         * @returns The ES256 JOSE signature.
         * @throws Crypto errors.
         */
        sign(input) {
          return sign('sha256', input, {
            key: KeyObject.from(pair.privateKey),
            dsaEncoding: 'ieee-p1363',
          });
        },
      };
    },
    /**
     * Return only the public authorization key.
     * @returns Protocol-compatible JWKS entries.
     */
    async publicKeys() {
      return [{ ...publicJwk, kid, use: 'sig' }];
    },
  };
}
