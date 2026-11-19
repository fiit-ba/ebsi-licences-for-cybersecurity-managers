import {
  FeeData,
  FetchRequest,
  JsonRpcProvider,
  Network,
  Transaction,
  toQuantity,
  type JsonRpcError,
  type Signer,
  type TransactionReceipt,
} from 'ethers';

/**
 * Supply the bearer token for one signed transaction.
 * @param raw - The signed transaction, as it will be sent.
 * @param fresh - Whether a cached token was just refused and a new one is needed.
 * @returns The token, or undefined when this transaction needs none.
 */
export type LedgerAuthorizer = (raw: string, fresh: boolean) => Promise<string | undefined>;

/**
 * EBSI's Ledger API (the pilot's `/ledger/v4/blockchains/besu`, Core API v1's `/v1/ledger`) as an
 * ethers provider.
 *
 * Reads go through unchanged and need no token. `eth_sendRawTransaction` carries the bearer
 * token its authorizer supplies, so every existing contract adapter sends through the Ledger
 * API without knowing about tokens. A refused token is replaced once.
 */
export class EbsiLedgerProvider extends JsonRpcProvider {
  readonly url: string;
  readonly #authorize?: LedgerAuthorizer;
  readonly #feesFromBlock: boolean;

  /**
   * Connect to the Ledger API of one chain.
   * @param url - The Ledger API (`/ledger/v4/blockchains/besu` on the pilot, `/v1/ledger` in Core
   * API v1), or a plain JSON-RPC endpoint in isolated tests.
   * @param chainId - The pinned chain.
   * @param authorize - Token source for signed transactions; omitted for read-only use.
   * @param options - `feesFromBlock`: price transactions from the block's base fee, for a Ledger
   * API that forwards no fee method (the pilot's).
   */
  constructor(
    url: string,
    chainId: number,
    authorize?: LedgerAuthorizer,
    options: { feesFromBlock?: boolean } = {},
  ) {
    const request = new FetchRequest(url);
    // A verifier waits at least 30 s for the ledger on a slow connection.
    request.timeout = 30_000;
    super(request, Network.from(chainId), {
      staticNetwork: true,
      batchMaxCount: 1,
      cacheTimeout: -1,
      // Onboarding waits for many receipts in turn; looking every second rather than every
      // 4 s keeps each wait close to the block time.
      pollingInterval: 1000,
    });
    this.url = url;
    this.#authorize = authorize;
    this.#feesFromBlock = options.feesFromBlock ?? false;
  }

  /**
   * The fees a transaction pays. EBSI's pilot Ledger API forwards no fee method (`eth_gasPrice`,
   * `eth_maxPriorityFeePerGas`), so they are priced from the latest block's base fee: zero on
   * the pilot, where gas is free, and enough on a development chain that charges it. A legacy
   * transaction (EBSI's registry transactions are legacy) and an EIP-1559 one (the governance
   * contract's) pay the same: twice the base fee.
   * @returns The fee data.
   * @throws Provider errors.
   */
  override async getFeeData(): Promise<FeeData> {
    if (!this.#feesFromBlock) return super.getFeeData();
    const base = (await this.getBlock('latest'))?.baseFeePerGas ?? 0n;
    return new FeeData(base * 2n, base * 2n, base);
  }

  /**
   * Send a JSON-RPC request; a signed transaction carries its bearer token.
   * @param method - JSON-RPC method.
   * @param params - Its parameters.
   * @returns The result.
   * @throws The provider's mapped JSON-RPC errors.
   */
  async send(method: string, params: Array<any> | Record<string, any>): Promise<any> {
    if (method !== 'eth_sendRawTransaction' || !this.#authorize) return super.send(method, params);
    const raw = String((params as unknown[])[0]);
    const token = await this.#authorize(raw, false);
    try {
      return await this.broadcastWithToken(raw, token);
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'TOKEN_REFUSED') throw error;
      return this.broadcastWithToken(raw, await this.#authorize(raw, true));
    }
  }

  /**
   * Send one signed transaction with an explicit bearer token.
   * @param raw - Signed transaction hex.
   * @param token - Bearer token, or undefined to send without one.
   * @returns The transaction hash.
   * @throws Error with code TOKEN_REFUSED when the API refuses the token; mapped JSON-RPC
   * errors; transport errors.
   */
  async broadcastWithToken(raw: string, token: string | undefined): Promise<string> {
    const payload = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [raw],
    };
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => undefined)) as
      { result?: string; error?: JsonRpcError['error'] } | undefined;
    if (body?.error) {
      // Both shapes answer a missing or insufficient token as a JSON-RPC error at HTTP 200:
      // Core API v1 with -32600, the pilot with a message about the token.
      if (body.error.code === -32600 || /token|unauthori[sz]ed/i.test(body.error.message ?? '')) {
        const refused = new Error(`The Ledger API refused the transaction: ${body.error.message}`);
        (refused as Error & { code: string }).code = 'TOKEN_REFUSED';
        throw refused;
      }
      throw this.getRpcError(payload, { id: 1, error: body.error } as JsonRpcError);
    }
    if (!response.ok || typeof body?.result !== 'string')
      throw new Error(`The Ledger API answered HTTP ${response.status}.`);
    return body.result;
  }
}

/**
 * Sign a registry call with a KMS ledger key and send it through the Ledger API with a token.
 *
 * @param options - Ledger provider, signing key, target, calldata, token and confirmations.
 * @returns The successful receipt.
 * @throws Error for a refused token, a reverted or unconfirmed transaction; RPC and KMS errors.
 * @remarks The caller serializes sends per key: nonce allocation happens here.
 */
export async function sendRegistryTransaction(options: {
  provider: EbsiLedgerProvider;
  signer: Signer;
  to: string;
  data: string;
  token: string;
  confirmations?: number;
}): Promise<TransactionReceipt> {
  const { provider, signer, to, data, token, confirmations = 1 } = options;
  const unsigned = await signer.populateTransaction({ to, data, type: 2, value: 0n });
  const raw = await signer.signTransaction(unsigned);
  const hash = await provider.broadcastWithToken(raw, token);
  const receipt = await provider.waitForTransaction(hash, confirmations, 120_000);
  if (!receipt || receipt.status !== 1)
    throw new Error('The registry transaction did not succeed.');
  return receipt;
}

/**
 * The gas limit a transaction is sent with: the node's estimate and a margin. An estimate is
 * exact for the state it was made in, and the transaction can execute in another one that costs
 * more (storage first written in a new period, another writer's transaction mined first); with
 * an exact limit it then runs out of gas. Gas is free on EBSI's networks.
 * @param estimate - The node's estimate.
 * @returns The limit: 30 % and 50 000 gas more.
 */
export function gasWithMargin(estimate: bigint) {
  return (estimate * 13n) / 10n + 50_000n;
}

/**
 * Send a registry transaction the pilot way: a legacy transaction (free on the pilot), signed
 * here and submitted to the registry's JSON-RPC `sendSignedTransaction` with the scope's token,
 * which is how EBSI's pilot accepts writes to its DID Registry and Trusted Issuers Registry.
 * @param options - The ledger (for the nonce, gas and receipt), the signer, the registry and its
 * JSON-RPC endpoint, the encoded call, and the access token.
 * @returns The receipt once mined.
 * @throws Error with `code: 'TOKEN_REFUSED'` when the registry refuses the token, a JSON-RPC
 * error, or a failed transaction.
 */
export async function sendSignedRegistryTransaction(options: {
  provider: EbsiLedgerProvider;
  signer: Signer;
  jsonrpc: string;
  to: string;
  data: string;
  token: string;
  chainId: number;
  confirmations?: number;
}): Promise<TransactionReceipt> {
  const { provider, signer, jsonrpc, to, data, token, chainId, confirmations = 1 } = options;
  const from = await signer.getAddress();
  const nonce = await provider.getTransactionCount(from, 'pending');
  const gasLimit = gasWithMargin(await provider.estimateGas({ from, to, data }));
  const gasPrice = (await provider.getFeeData()).gasPrice ?? 0n;
  const raw = await signer.signTransaction({
    type: 0,
    from,
    to,
    data,
    nonce,
    gasLimit,
    gasPrice,
    chainId,
    value: 0n,
  });
  const signed = Transaction.from(raw);
  const signature = signed.signature!;
  const response = await fetch(jsonrpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendSignedTransaction',
      params: [
        {
          protocol: 'eth',
          unsignedTransaction: {
            from,
            to,
            data,
            nonce: toQuantity(nonce),
            chainId: toQuantity(chainId),
            gasLimit: toQuantity(gasLimit),
            gasPrice: toQuantity(gasPrice),
            value: '0x0',
          },
          r: signature.r,
          s: signature.s,
          v: toQuantity(signature.networkV ?? signature.v),
          signedRawTransaction: raw,
        },
      ],
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => undefined)) as
    { result?: string; error?: { code?: number; message?: string } } | undefined;
  if (response.status === 401 || response.status === 403) {
    const refused = new Error(`The registry refused the access token (HTTP ${response.status}).`);
    (refused as Error & { code: string }).code = 'TOKEN_REFUSED';
    throw refused;
  }
  if (body?.error) throw new Error(`The registry refused the transaction: ${body.error.message}`);
  if (!response.ok || typeof body?.result !== 'string')
    throw new Error(`The registry's JSON-RPC answered HTTP ${response.status}.`);
  const receipt = await provider.waitForTransaction(body.result, confirmations, 120_000);
  if (!receipt || receipt.status !== 1)
    throw new Error('The registry transaction did not succeed.');
  return receipt;
}
