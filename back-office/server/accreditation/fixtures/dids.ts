import { randomBytes } from 'node:crypto';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * A fresh legal entity's did:ebsi, as an appointed organization brings its own.
 * @returns `did:ebsi:z` and the base58 of version byte 1 and 16 random bytes.
 */
export function testDid() {
  let value = BigInt('0x' + Buffer.concat([Buffer.from([1]), randomBytes(16)]).toString('hex'));
  let encoded = '';
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return 'did:ebsi:z' + encoded;
}

/**
 * A DID Registry that knows every DID, for checks that do not exercise the registry.
 * @returns True.
 */
export async function anyDid() {
  return true;
}
