import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { SigningKey } from 'ethers';
import {
  CreateKeyCommand,
  DescribeKeyCommand,
  GetPublicKeyCommand,
  ListResourceTagsCommand,
  SignCommand,
} from '@aws-sdk/client-kms';
import type { KMSClient } from '@aws-sdk/client-kms';

/** In-memory key owned exclusively by the synthetic KMS fixture. */
interface FixtureKey {
  arn: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  spec: 'ECC_NIST_P256' | 'ECC_SECG_P256K1';
  tags: { TagKey: string; TagValue: string }[];
  enabled: boolean;
}

// NIST P-256 (FIPS 186-4, D.1.2.3), for signing a digest as KMS does: Node signs messages only.
const p256 = {
  p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
  n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  g: [
    0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  ] as [bigint, bigint],
};
const mod = (value: bigint, modulus: bigint) => ((value % modulus) + modulus) % modulus;
/**
 * The inverse modulo a prime.
 * @param value - Element.
 * @param modulus - Prime modulus.
 * @returns value^-1.
 */
function inverse(value: bigint, modulus: bigint) {
  let result = 1n;
  let base = mod(value, modulus);
  for (let exponent = modulus - 2n; exponent > 0n; exponent >>= 1n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}
/**
 * Add two P-256 points (null is the point at infinity).
 * @param a - First point.
 * @param b - Second point.
 * @returns a + b.
 */
function add(a: [bigint, bigint] | null, b: [bigint, bigint] | null): [bigint, bigint] | null {
  if (!a) return b;
  if (!b) return a;
  const { p } = p256;
  if (a[0] === b[0] && mod(a[1] + b[1], p) === 0n) return null;
  const slope =
    a[0] === b[0]
      ? mod(3n * a[0] * a[0] - 3n, p) * inverse(2n * a[1], p)
      : mod(b[1] - a[1], p) * inverse(b[0] - a[0], p);
  const x = mod(slope * slope - a[0] - b[0], p);
  return [x, mod(slope * (a[0] - x) - a[1], p)];
}
/**
 * An ECDSA signature over a digest, DER-encoded as KMS returns it.
 * @param key - Fixture key.
 * @param digest - 32-byte SHA-256 digest.
 * @returns DER signature.
 */
function digestSignature(key: FixtureKey, digest: Buffer) {
  const d = BigInt(
    '0x' + Buffer.from(key.privateKey.export({ format: 'jwk' }).d!, 'base64url').toString('hex'),
  );
  let r: bigint;
  let s: bigint;
  if (key.spec === 'ECC_SECG_P256K1') {
    const signature = new SigningKey('0x' + d.toString(16).padStart(64, '0')).sign(digest);
    r = BigInt(signature.r);
    s = BigInt(signature.s);
  } else {
    const { n, g } = p256;
    const e = BigInt('0x' + digest.toString('hex'));
    for (;;) {
      const k = mod(BigInt('0x' + randomBytes(32).toString('hex')), n - 1n) + 1n;
      let point: [bigint, bigint] | null = null;
      let addend: [bigint, bigint] | null = g;
      for (let bits = k; bits > 0n; bits >>= 1n) {
        if (bits & 1n) point = add(point, addend);
        addend = add(addend, addend);
      }
      r = mod(point![0], n);
      s = mod(inverse(k, n) * (e + r * d), n);
      if (r && s) break;
    }
  }
  const integer = (value: bigint) => {
    let bytes = Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
    while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.subarray(1);
    if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const body = Buffer.concat([integer(r!), integer(s!)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/**
 * Provide real EC cryptography behind fake AWS command responses for isolated tests.
 * @returns A client double, owned key inventory, creation controls and signing input assertion.
 * @remarks This fixture never calls AWS. Private test keys stay only in this helper's memory.
 */
export function kmsCeremonyFixture() {
  const keys = new Map<string, FixtureKey>();
  const state = {
    creates: 0,
    loseNextResponse: false,
    attempts: 1,
    signingInput: Buffer.from('header.payload'),
  };
  const client = {
    config: { maxAttempts: async () => state.attempts },
    /**
     * Simulate the KMS requests consumed by key-ceremony integration checks.
     * @param command - Synthetic creation, lookup, metadata or signing request.
     * @returns The matching SDK response backed by the fixture's private test state.
     * @throws Error for injected response loss or an unsupported fixture command.
     */
    async send(
      command:
        | CreateKeyCommand
        | DescribeKeyCommand
        | GetPublicKeyCommand
        | ListResourceTagsCommand
        | SignCommand,
    ) {
      if (command instanceof CreateKeyCommand) {
        state.creates++;
        const spec = command.input.KeySpec;
        if (spec !== 'ECC_NIST_P256' && spec !== 'ECC_SECG_P256K1')
          throw new Error('Unexpected KMS key spec.');
        const pair = generateKeyPairSync('ec', {
          namedCurve: spec === 'ECC_NIST_P256' ? 'prime256v1' : 'secp256k1',
        });
        const arn = 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID();
        keys.set(arn, {
          arn,
          ...pair,
          spec,
          tags: command.input.Tags as FixtureKey['tags'],
          enabled: true,
        });
        if (state.loseNextResponse) {
          state.loseNextResponse = false;
          throw new Error('Synthetic response lost after creation.');
        }
        return { KeyMetadata: { KeyId: arn.split('/').at(-1), Arn: arn } };
      }
      const locator = command.input.KeyId!;
      const key =
        keys.get(locator) ??
        [...keys.values()].find((candidate) => candidate.arn.endsWith('/' + locator));
      if (!key) throw new Error('Unknown fixture KMS key.');
      if (command instanceof GetPublicKeyCommand)
        return {
          KeyId: key.arn,
          KeyUsage: 'SIGN_VERIFY',
          KeySpec: key.spec,
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: key.publicKey.export({ type: 'spki', format: 'der' }),
        };
      if (command instanceof DescribeKeyCommand)
        return {
          KeyMetadata: {
            Arn: key.arn,
            KeyUsage: 'SIGN_VERIFY',
            KeyState: key.enabled ? 'Enabled' : 'Disabled',
          },
        };
      if (command instanceof ListResourceTagsCommand) return { Tags: key.tags, Truncated: false };
      if (command instanceof SignCommand) {
        const message = Buffer.from(command.input.Message!);
        // A digest, as the back-office sends: JWS signing input and transaction hashes alike.
        if (command.input.MessageType === 'DIGEST') {
          if (message.length !== 32) throw new Error('Unexpected signing digest.');
          return { Signature: digestSignature(key, message), SigningAlgorithm: 'ECDSA_SHA_256' };
        }
        return {
          Signature: sign('sha256', message, key.privateKey),
          SigningAlgorithm: 'ECDSA_SHA_256',
        };
      }
      throw new Error('Unexpected fixture KMS command.');
    },
  } as unknown as KMSClient;
  return { client, keys, state };
}
