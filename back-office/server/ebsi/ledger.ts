import {
  FetchRequest,
  JsonRpcProvider,
  Network,
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
 * EBSI's Core API v1 Ledger API (`POST /v1/ledger`) as an ethers provider.
 *
 * Reads go through unchanged and need no token. `eth_sendRawTransaction` carries the bearer
 * token its authorizer supplies, so every existing contract adapter sends through the Ledger
 * API without knowing about tokens. A refused token is replaced once.
 */
export class EbsiLedgerProvider extends JsonRpcProvider {
  readonly url: string;
  readonly #authorize?: LedgerAuthorizer;

  /**
   * Connect to the Ledger API of one chain.
   * @param url - The `/v1/ledger` endpoint, or a plain JSON-RPC endpoint in isolated tests.
   * @param chainId - The pinned chain.
   * @param authorize - Token source for signed transactions; omitted for read-only use.
   */
  constructor(url: string, chainId: number, authorize?: LedgerAuthorizer) {
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
      // Core API v1 answers a missing or insufficient token with -32600 at HTTP 200.
      if (body.error.code === -32600) {
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
