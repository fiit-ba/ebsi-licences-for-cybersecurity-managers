import { createPublicKey } from 'node:crypto';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import {
  AbstractSigner,
  computeAddress,
  getAddress,
  getBytes,
  recoverAddress,
  Transaction,
  type TransactionRequest,
  type TransactionLike,
  type Provider,
} from 'ethers';
import type { KmsSigningClient } from './kms-types.ts';
import { rawEcdsaSignature } from './kms-ecdsa.ts';

const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Transaction-only secp256k1 KMS signer with per-instance send serialization. */
class KmsLedgerSigner extends AbstractSigner {
  #sending: Promise<unknown> = Promise.resolve();
  readonly kms: KmsSigningClient;
  readonly keyId: string;
  readonly address: string;
  readonly chainId: number;

  /**
   * Bind a ledger signer to one immutable KMS key and chain.
   *
   * @param provider - RPC provider.
   * @param kms - KMS client.
   * @param keyId - Pinned KMS key identifier.
   * @param address - Verified Ethereum address.
   * @param chainId - Expected chain ID.
   */
  constructor(
    provider: Provider | null,
    kms: KmsSigningClient,
    keyId: string,
    address: string,
    chainId: number,
  ) {
    super(provider);
    this.kms = kms;
    this.keyId = keyId;
    this.address = address;
    this.chainId = chainId;
  }

  /**
   * Return the verified KMS signer address.
   *
   * @returns The checksummed Ethereum address.
   */
  async getAddress() {
    return this.address;
  }

  /**
   * Create a signer for the same key on another provider.
   *
   * @param provider - Replacement RPC provider.
   * @returns A new signer instance with its own send queue.
   */
  connect(provider: Provider | null) {
    return new KmsLedgerSigner(provider, this.kms, this.keyId, this.address, this.chainId);
  }

  /**
   * Serialize nonce allocation and sending within this signer instance.
   *
   * @param transaction - Unsigned Ethereum transaction request.
   * @returns The submitted transaction response.
   * @throws Provider or signing errors from ethers.
   * @remarks Deployment must still dedicate the key to one active writer.
   */
  sendTransaction(transaction: TransactionRequest) {
    // Serialise nonce allocation and broadcast within this process. The
    // deployment must dedicate the signer to a single active writer.
    const sending = this.#sending.then(() => super.sendTransaction(transaction));
    this.#sending = sending.catch(() => {});
    return sending;
  }

  /**
   * Reject arbitrary-message signing.
   *
   * @returns A promise that always rejects.
   * @throws Error because this signer permits transactions only.
   */
  async signMessage(): Promise<never> {
    throw new Error('The governance KMS signer signs transactions only.');
  }

  /**
   * Reject typed-data signing.
   *
   * @returns A promise that always rejects.
   * @throws Error because this signer permits transactions only.
   */
  async signTypedData(): Promise<never> {
    throw new Error('The governance KMS signer signs transactions only.');
  }

  /**
   * Sign a transaction only for the configured sender and chain.
   *
   * @param request - Unsigned ethers transaction request.
   * @returns Serialized signed transaction bytes as hex.
   * @throws Error for a mismatched sender/chain, malformed transaction or invalid signature;
   * KMS/provider errors.
   */
  async signTransaction(request: TransactionRequest) {
    // ethers sendTransaction passes a Transaction instance whose fields are getters.
    // Spreading it drops chainId/calldata along with the transport-only sender.
    const { from, ...plain } = request;
    const unsigned = request instanceof Transaction ? request : plain;
    if (from && getAddress(from as string) !== this.address)
      throw new Error('Governance sender does not match the KMS key.');
    const transaction = Transaction.from(unsigned as TransactionLike);
    if (transaction.chainId !== BigInt(this.chainId) || transaction.signature) {
      throw new Error('Expected an unsigned transaction for the configured governance chain.');
    }
    const digest = transaction.unsignedHash;
    const response = await this.kms.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: getBytes(digest),
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    if (response.SigningAlgorithm !== 'ECDSA_SHA_256' || !response.Signature) {
      throw new Error('KMS did not return a governance signature.');
    }

    const raw = rawEcdsaSignature(response.Signature, order);
    const r = '0x' + raw.subarray(0, 32).toString('hex');
    const s = '0x' + raw.subarray(32).toString('hex');
    for (const yParity of [0, 1] as const) {
      const signature = { r, s, yParity };
      if (recoverAddress(digest, signature) === this.address) {
        transaction.signature = signature;
        return transaction.serialized;
      }
    }
    throw new Error('KMS signature does not match the configured governance key.');
  }
}

/**
 * Discover and pin a secp256k1 KMS key before creating its signer.
 *
 * @param options - Provider, KMS client, configured key ID and positive chain ID.
 * @returns A transaction-only signer with a verified address and immutable key ID.
 * @throws Error for invalid configuration or an unsupported public key; KMS and crypto errors.
 */
export async function kmsLedgerSigner(options: {
  provider: Provider;
  kms: KmsSigningClient;
  keyId: string;
  chainId: number;
}) {
  const { provider, kms, keyId, chainId } = options;

  if (!keyId || !Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error('Configure a KMS ledger key and chain ID.');
  const key = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }), {
    abortSignal: AbortSignal.timeout(10_000),
  });
  if (
    !key.KeyId ||
    key.KeySpec !== 'ECC_SECG_P256K1' ||
    key.KeyUsage !== 'SIGN_VERIFY' ||
    !key.PublicKey
  ) {
    throw new Error('The governance KMS key must be a secp256k1 signing key.');
  }
  const publicKey = createPublicKey({
    key: Buffer.from(key.PublicKey),
    type: 'spki',
    format: 'der',
  }).export({ format: 'jwk' });
  if (publicKey.crv !== 'secp256k1') throw new Error('The governance public key is not secp256k1.');
  const coordinates = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(publicKey.x!, 'base64url'),
    Buffer.from(publicKey.y!, 'base64url'),
  ]);
  // Pin the returned key identity so alias changes cannot silently swap signers.
  return new KmsLedgerSigner(
    provider,
    kms,
    key.KeyId,
    computeAddress('0x' + coordinates.toString('hex')),
    chainId,
  );
}
