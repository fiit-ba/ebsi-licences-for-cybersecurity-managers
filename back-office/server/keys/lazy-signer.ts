import { AbstractSigner, type Provider, type Signer, type TransactionRequest } from 'ethers';

/** Dependency-lazy signer so local lifecycle admission never needs KMS or ledger at startup. */
class LazySigner extends AbstractSigner {
  readonly initialize: () => Promise<Signer>;
  #signer?: Promise<Signer>;
  /**
   * Bind the configured provider without contacting external dependencies.
   * @param provider - Pinned provider retained by the owning runtime.
   * @param initialize - Key discovery and purpose-bound signer factory.
   */
  constructor(provider: Provider, initialize: () => Promise<Signer>) {
    super(provider);
    this.initialize = initialize;
  }
  /**
   * Resolve the dedicated signer, retrying initialization after dependency failure.
   * @returns The successfully initialized signer.
   * @throws Initialization/KMS errors.
   */
  async resolve() {
    this.#signer ??= this.initialize().catch((error) => {
      this.#signer = undefined;
      throw error;
    });
    return this.#signer;
  }
  /**
   * Resolve the public key only when an operation actually needs its address.
   * @returns Verified signing address.
   * @throws KMS or key configuration errors.
   */
  async getAddress() {
    return (await this.resolve()).getAddress();
  }
  /**
   * Preserve the pinned provider identity.
   * @param provider - Requested provider.
   * @returns This signer for the same provider.
   * @throws Error when the requested provider differs.
   */
  connect(provider: Provider | null) {
    if (provider !== this.provider)
      throw new Error('The lazy signer is bound to its configured provider.');
    return this;
  }
  /**
   * Refuse arbitrary-message signing independently of dependency availability.
   * @returns Never returns successfully.
   * @throws Error because only domain-authorized transactions are supported.
   */
  async signMessage(): Promise<never> {
    throw new Error('Only authorized transactions may be signed.');
  }
  /**
   * Refuse typed-data signing independently of dependency availability.
   * @returns Never returns successfully.
   * @throws Error because only domain-authorized transactions are supported.
   */
  async signTypedData(): Promise<never> {
    throw new Error('Only authorized transactions may be signed.');
  }
  /**
   * Delegate exact-intent signing to the dedicated purpose-bound implementation.
   * @param request - Transaction request selected by the owning adapter.
   * @returns Signed transaction bytes when the underlying adapter permits direct signing.
   * @throws Signing, authorization, KMS or provider errors.
   */
  async signTransaction(request: TransactionRequest) {
    return (await this.resolve()).signTransaction(request);
  }
  /**
   * Delegate durable signing and submission after lazy dependency initialization.
   * @param request - Domain-authorized transaction request.
   * @returns Submitted or reconciled transaction response.
   * @throws Signing, authorization, KMS or provider errors.
   */
  async sendTransaction(request: TransactionRequest) {
    return (await this.resolve()).sendTransaction(request);
  }
}

/**
 * Defer key/network discovery until an operation requires a signature or signer label.
 * @param provider - Configured provider, with no startup network request required.
 * @param initialize - Factory that validates and pins the actual dedicated key.
 * @returns A transaction-only dependency-lazy signer.
 */
export function lazyLedgerSigner(provider: Provider, initialize: () => Promise<Signer>): Signer {
  return new LazySigner(provider, initialize);
}
