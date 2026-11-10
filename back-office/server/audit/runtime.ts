import { configuredFieldProtection } from '../keys/field-protection.ts';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { KMSClient } from '@aws-sdk/client-kms';
import { FetchRequest, JsonRpcProvider, getAddress } from 'ethers';
import { kmsLedgerSigner } from '../issuance/kms-ledger-signer.ts';
import { postgresAnchorDelivery } from './anchor-delivery.ts';
import type { TimestampLedger } from './timestamp-ledger.ts';
import { timestampLedger } from './timestamp-ledger.ts';

/**
 * Read and validate the externally supplied timestamp bearer file.
 *
 * @param path - Path to a compact JWT file.
 * @returns The trimmed bearer JWT.
 * @throws Filesystem errors, or Error if content is oversized or not a compact JWT.
 * @remarks The file is reread for outgoing requests so an external token refresh is observed.
 */
export async function timestampBearer(path: string) {
  const value = (await readFile(path, 'utf8')).trim();
  if (value.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('The timestamp access token file must contain a compact bearer JWT.');
  }
  return value;
}

/**
 * Initialize an optional dedicated KMS timestamp runtime.
 *
 * @param database - PostgreSQL pool.
 * @param env - Environment settings; defaults to process.env.
 * @param otherSigners - Other transaction-writer addresses that cannot share the timestamp key.
 * @returns Ledger, delivery worker and cleanup function, or undefined when disabled.
 * @throws Error for invalid settings, shared signer identity or missing contract; filesystem, KMS
 * and RPC errors.
 */
export async function configuredTimestamp(
  database: Pool,
  env = process.env,
  otherSigners: string[] | (() => Promise<string[]>) = [],
) {
  const enabled = env.BACK_OFFICE_TIMESTAMP_ENABLED ?? 'false';
  if (enabled === 'false') return;
  if (enabled !== 'true') throw new Error('BACK_OFFICE_TIMESTAMP_ENABLED must be true or false.');
  const required = [
    'AWS_REGION',
    'BACK_OFFICE_TIMESTAMP_KMS_KEY_ID',
    'BACK_OFFICE_TIMESTAMP_RPC_URL',
    'BACK_OFFICE_TIMESTAMP_CHAIN_ID',
    'BACK_OFFICE_TIMESTAMP_CONTRACT',
    'BACK_OFFICE_TIMESTAMP_ACCESS_TOKEN_FILE',
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error('Missing timestamp settings: ' + missing.join(', '));
  if (
    [env.BACK_OFFICE_LEDGER_KMS_KEY_ID, env.BACK_OFFICE_GOVERNANCE_APPROVER_KMS_KEY_ID].includes(
      env.BACK_OFFICE_TIMESTAMP_KMS_KEY_ID!,
    )
  )
    throw new Error('Timestamping requires a separate KMS key.');
  const chainId = Number(env.BACK_OFFICE_TIMESTAMP_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Invalid timestamp chain ID.');
  const url = new URL(env.BACK_OFFICE_TIMESTAMP_RPC_URL!);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Timestamp RPC must be an HTTP(S) URL without credentials or a fragment.');
  }
  await timestampBearer(env.BACK_OFFICE_TIMESTAMP_ACCESS_TOKEN_FILE!);
  const request = new FetchRequest(url.href);
  request.timeout = 10_000;
  request.preflightFunc = async (outgoing) => {
    outgoing.setHeader(
      'authorization',
      'Bearer ' + (await timestampBearer(env.BACK_OFFICE_TIMESTAMP_ACCESS_TOKEN_FILE!)),
    );
    return outgoing;
  };
  const provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  const kms = new KMSClient({
    region: env.AWS_REGION,
    endpoint: env.PLR_KMS_ENDPOINT_URL || undefined,
  });
  const protection = configuredFieldProtection(database, env);
  let live: TimestampLedger | undefined;
  let initializing: Promise<TimestampLedger> | undefined;
  /**
   * Initialize timestamp dependencies only for evidence/delivery work, retrying outages later.
   * @returns The validated dedicated timestamp adapter.
   * @throws KMS, RPC, key-separation or contract validation errors.
   */
  async function initialize(): Promise<TimestampLedger> {
    initializing ??= (async () => {
      if ((await provider.getNetwork()).chainId !== BigInt(chainId))
        throw new Error('Timestamp chain ID does not match.');
      const signer = await kmsLedgerSigner({
        provider,
        kms,
        keyId: env.BACK_OFFICE_TIMESTAMP_KMS_KEY_ID!,
        chainId,
      });
      const addresses = typeof otherSigners === 'function' ? await otherSigners() : otherSigners;
      if (addresses.map(getAddress).includes(await signer.getAddress()))
        throw new Error('Timestamping requires a separate signing address.');
      const ledger = await timestampLedger({
        signer,
        chainId,
        address: env.BACK_OFFICE_TIMESTAMP_CONTRACT!,
        confirmations: Number(env.BACK_OFFICE_TIMESTAMP_CONFIRMATIONS ?? 1),
        gasLimit: BigInt(env.BACK_OFFICE_TIMESTAMP_GAS_LIMIT ?? '500000'),
        gasPrice: BigInt(env.BACK_OFFICE_TIMESTAMP_MAX_GAS_PRICE_WEI ?? '0'),
      });
      if ((await provider.getCode(ledger.contract)) === '0x')
        throw new Error('No timestamp contract at the configured address.');
      live = ledger;
      return ledger;
    })().catch((error) => {
      initializing = undefined;
      throw error;
    });
    return initializing;
  }
  const ledger: TimestampLedger = {
    chainId,
    contract: getAddress(env.BACK_OFFICE_TIMESTAMP_CONTRACT!),
    get signerAddress() {
      return live?.signerAddress ?? '';
    },
    observe: async (digest) => (await initialize()).observe(digest),
    prepare: async (digest) => (await initialize()).prepare(digest),
    broadcast: async (digest, signed) => (await initialize()).broadcast(digest, signed),
  };
  return {
    ledger,
    /**
     * Deliver durable timestamp work without making local decisions depend on the provider.
     * @param anchorId - Optional concrete anchor that wakes the ordered timestamp queue.
     * @returns Completion of one bounded timestamp delivery batch.
     * @throws KMS/RPC or database errors; signed uncertain submissions remain durable.
     */
    async deliver(anchorId?: string) {
      return postgresAnchorDelivery(database, await initialize(), protection)(anchorId);
    },
    /**
     * Release only the timestamp runtime's owned KMS client and RPC provider.
     * @returns No return value.
     */
    close() {
      provider.destroy();
      kms.destroy();
      protection.close();
    },
  };
}
