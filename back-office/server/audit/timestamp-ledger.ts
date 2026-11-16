import { createHash, randomBytes } from 'node:crypto';
import {
  AbiCoder,
  Contract,
  Interface,
  Transaction,
  ZeroAddress,
  concat,
  getAddress,
  hexlify,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers';
import type { Signer } from 'ethers';

// Interface declarations from EBSI's Timestamp contract (contracts/local/ebsi-mock/timestamp),
// not implementation code.
const abi = [
  'function commitTimestampHashes(bytes32 commitment)',
  'function timestampHashes(uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes32 salt) returns (bytes32[])',
  'function getTimestamp(bytes hashValue) view returns (tuple(uint256 algorithm,bytes value) hash,address timestampedBy,uint256 blockNumber,bytes data)',
  'function getTimestampCommitmentBlock(address committedBy, bytes32 commitment) view returns (uint64)',
  'function getHashAlgorithms(uint256 page, uint256 pageSize) view returns (uint256[] items, uint256 total, uint256 howMany, uint256 prev, uint256 next)',
  'function getHashAlgorithmById(uint256 hashAlgorithmId) view returns (uint256 outputLength, string ianaName, string oid, uint8 status, string multiHash)',
  'function TIMESTAMP_COMMITMENT_MATURITY() view returns (uint64)',
  'error TimestampUnknown()',
];
const encoding = new Interface(abi);
const digestPattern = /^0x[0-9a-f]{64}$/;
const commitmentType = keccak256(
  toUtf8Bytes(
    'TimestampCommitment(uint256 chainId,address verifyingContract,address committedBy,uint256[] hashAlgorithmIds,bytes[] hashValues,bytes[] timestampData,bytes32 salt)',
  ),
);
/** How long one delivery waits for a commitment to mature and for the timestamp's block. */
const waitMs = 120_000;

/** Confirmed block identity and clock evidence for a timestamp record. */
export interface TimestampProof {
  blockNumber: string;
  blockHash: string;
  timestamp: string;
}

/** Observed absence, pending inclusion or confirmed timestamp proof. */
export type TimestampObservation =
  { state: 'missing' | 'pending' } | { state: 'confirmed'; proof: TimestampProof };
/**
 * The two signed transactions of one timestamp, signed together before either is sent: the
 * commitment (nonce n) and the timestamp that reveals it (nonce n+1). `raw`, `hash` and `nonce`
 * are the timestamp's, the transaction that creates the record.
 */
export interface SignedTimestamp {
  raw: string;
  hash: string;
  nonce: string;
  commitRaw: string;
  commitHash: string;
}

/** Pinned timestamp deployment and exact-intent signing, observation and broadcast operations. */
export interface TimestampLedger {
  chainId: number;
  contract: string;
  signerAddress: string;
  observe(digest: string): Promise<TimestampObservation>;
  prepare(digest: string): Promise<SignedTimestamp>;
  broadcast(digest: string, transaction: SignedTimestamp): Promise<void>;
}

/**
 * Derive the Timestamp Registry multibase identifier from a SHA-256 digest.
 *
 * @param digest - Lowercase 0x-prefixed 32-byte digest.
 * @returns The base64url multibase SHA-256 multihash identifier.
 * @throws Error for a malformed or nonlowercase digest.
 */
export function timestampId(digest: string) {
  if (!digestPattern.test(digest)) throw new Error('Expected a lowercase SHA-256 digest.');
  const hashed = createHash('sha256')
    .update(Buffer.from(digest.slice(2), 'hex'))
    .digest();
  return 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), hashed]).toString('base64url');
}

/**
 * The commitment EBSI's Timestamp contract expects before it timestamps one hash without data,
 * as its `computeTimestampCommitment` computes it.
 *
 * @param fields - Chain, contract, committing address, algorithm id, digest and salt.
 * @returns The 0x-hex commitment.
 */
export function timestampCommitment(fields: {
  chainId: number;
  contract: string;
  committedBy: string;
  algorithm: bigint;
  digest: string;
  salt: string;
}) {
  const bytesArray = (values: string[]) =>
    keccak256(concat(values.map((value) => keccak256(value))));
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'address', 'address', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
      [
        commitmentType,
        fields.chainId,
        fields.contract,
        fields.committedBy,
        keccak256(zeroPadValue(toBeHex(fields.algorithm), 32)),
        bytesArray([fields.digest]),
        bytesArray(['0x']),
        fields.salt,
      ],
    ),
  );
}

/**
 * Create an adapter for EBSI's Timestamp contract with bounded empty-data submissions. The
 * contract takes a hash only from a sender that committed to it at least its maturity (five
 * blocks) earlier, so each timestamp is two transactions: the commitment, then the timestamp.
 *
 * @param options - Signer, positive chain ID, contract address, confirmations and gas bounds.
 * @returns A deployment-pinned timestamp adapter.
 * @throws Error for invalid signer, deployment or fee configuration, or a contract that offers no
 * SHA-256; address/provider errors.
 */
export async function timestampLedger(options: {
  signer: Signer;
  chainId: number;
  address: string;
  confirmations?: number;
  gasLimit?: bigint;
  gasPrice?: bigint;
}): Promise<TimestampLedger> {
  const {
    signer,
    chainId,
    address,
    confirmations = 1,
    gasLimit = 500_000n,
    gasPrice = 0n,
  } = options;

  const provider = signer.provider;
  const contract = getAddress(address);
  const signerAddress = getAddress(await signer.getAddress());
  if (
    !provider ||
    contract === ZeroAddress ||
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    gasLimit <= 0n ||
    gasLimit > 2_000_000n ||
    gasPrice < 0n
  ) {
    throw new Error('Invalid timestamp ledger configuration.');
  }
  const reader = new Contract(contract, abi, provider);
  /**
   * Require the RPC provider to serve the configured timestamp chain.
   *
   * @returns Completion when the chain matches.
   * @throws Error for a different chain; RPC errors.
   */
  async function network() {
    if ((await provider!.getNetwork()).chainId !== BigInt(chainId))
      throw new Error('Timestamp chain ID does not match.');
  }
  await network();
  // The contract numbers its algorithms itself; SHA-256 is the one named sha-256.
  let algorithm: bigint | undefined;
  for (const id of (await reader.getHashAlgorithms(1, 50)).items as bigint[]) {
    const found = await reader.getHashAlgorithmById(id);
    if (found.ianaName === 'sha-256' && found.status === 1n && found.outputLength === 256n)
      algorithm = id;
  }
  if (algorithm === undefined) throw new Error('The timestamp contract offers no SHA-256.');
  const sha256 = algorithm;
  const maturity = Number(await reader.TIMESTAMP_COMMITMENT_MATURITY());

  const commitData = (commitment: string) =>
    encoding.encodeFunctionData('commitTimestampHashes', [commitment]);
  const revealData = (digest: string, salt: string) => {
    if (!digestPattern.test(digest)) throw new Error('Expected a lowercase SHA-256 digest.');
    return encoding.encodeFunctionData('timestampHashes', [[sha256], [digest], ['0x'], salt]);
  };
  const commitmentOf = (digest: string, salt: string) =>
    timestampCommitment({
      chainId,
      contract,
      committedBy: signerAddress,
      algorithm: sha256,
      digest,
      salt,
    });
  /**
   * Read a timestamp and require digest, algorithm, signer and data to match.
   *
   * @param digest - Expected lowercase digest.
   * @param blockTag - Block at which to read.
   * @returns The matching record, or null when absent.
   * @throws Error for a mismatched record; RPC errors.
   */
  async function read(digest: string, blockTag: number | 'latest') {
    let value;
    try {
      value = await reader.getTimestamp(digest, { blockTag });
    } catch (error) {
      // The contract refuses to read a hash it has never timestamped.
      if ((error as { revert?: { name?: string } })?.revert?.name === 'TimestampUnknown')
        return null;
      throw error;
    }
    if (value.timestampedBy === ZeroAddress && value.blockNumber === 0n) return null;
    if (
      value.hash.algorithm !== sha256 ||
      value.hash.value.toLowerCase() !== digest ||
      value.data !== '0x' ||
      getAddress(value.timestampedBy) !== signerAddress
    )
      throw new Error('Timestamp record does not match this submission.');
    return value;
  }
  /**
   * Require one signed transaction to be this signer's bounded call on the contract.
   *
   * @param raw - Signed transaction hex.
   * @param data - Expected calldata.
   * @param nonce - Expected nonce.
   * @returns The decoded transaction.
   * @throws Error for a mismatched field.
   */
  function bounded(raw: string, data: string, nonce: bigint) {
    const transaction = Transaction.from(raw);
    if (
      !transaction.signature ||
      transaction.chainId !== BigInt(chainId) ||
      transaction.to !== contract ||
      transaction.from !== signerAddress ||
      transaction.data !== data ||
      transaction.value !== 0n ||
      transaction.type !== 0 ||
      transaction.gasLimit > gasLimit ||
      transaction.gasLimit <= 0n ||
      transaction.gasPrice === null ||
      transaction.gasPrice < 0n ||
      transaction.gasPrice > gasPrice ||
      BigInt(transaction.nonce) !== nonce
    )
      throw new Error('The signed timestamp transaction does not match its durable intent.');
    return transaction;
  }
  /**
   * Require both signed transactions to match the durable timestamp intent and fee bounds, and
   * return the salt the timestamp reveals.
   *
   * @param digest - Expected digest.
   * @param signed - Both raw transactions, their hashes and the timestamp's nonce.
   * @returns The salt.
   * @throws Error for malformed or mismatched signed transactions.
   */
  function validate(digest: string, signed: SignedTimestamp) {
    let salt: string;
    try {
      const call = encoding.parseTransaction({ data: Transaction.from(signed.raw).data });
      salt = String(call?.name === 'timestampHashes' ? call.args.salt : '');
    } catch {
      salt = '';
    }
    if (
      !/^0x[0-9a-f]{64}$/.test(salt) ||
      !/^\d+$/.test(signed.nonce) ||
      BigInt(signed.nonce) < 1n ||
      keccak256(signed.raw) !== signed.hash ||
      keccak256(signed.commitRaw ?? '0x') !== signed.commitHash
    )
      throw new Error('The signed timestamp transaction does not match its durable intent.');
    bounded(signed.raw, revealData(digest, salt), BigInt(signed.nonce));
    bounded(signed.commitRaw, commitData(commitmentOf(digest, salt)), BigInt(signed.nonce) - 1n);
    return salt;
  }
  /**
   * Send one stored transaction unless the node already has it.
   *
   * @param raw - Signed bytes.
   * @param hash - Their hash.
   * @returns Completion once the node holds the transaction.
   * @throws Error for a different returned hash; RPC errors.
   */
  async function send(raw: string, hash: string) {
    if (await provider!.getTransaction(hash)) return;
    const response = await provider!.broadcastTransaction(raw);
    if (response.hash !== hash)
      throw new Error('Timestamp broadcast returned a different transaction hash.');
  }
  /**
   * Wait until the chain has reached a block.
   *
   * @param target - Block number.
   * @param deadline - Epoch milliseconds to give up at.
   * @returns Completion when reached.
   * @throws Error when the chain does not get there in time; RPC errors.
   */
  async function reach(target: number, deadline: number) {
    while ((await provider!.getBlockNumber()) < target) {
      if (Date.now() > deadline) throw new Error('The timestamp commitment has not matured yet.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return {
    chainId,
    contract,
    signerAddress,
    /**
     * Observe the exact timestamp and its stable block evidence.
     *
     * @param digest - Expected lowercase digest.
     * @returns Missing, pending or confirmed observation with proof.
     * @throws Error for wrong chain, mismatched record or missing block; RPC errors.
     */
    async observe(digest) {
      revealData(digest, '0x' + '00'.repeat(32));
      await network();
      const latest = await read(digest, 'latest');
      if (!latest) return { state: 'missing' };
      const stableBlock = (await provider!.getBlockNumber()) - confirmations + 1;
      if (stableBlock < 0 || latest.blockNumber > BigInt(stableBlock)) return { state: 'pending' };
      const stable = await read(digest, stableBlock);
      if (!stable || stable.blockNumber !== latest.blockNumber) return { state: 'pending' };
      const block = await provider!.getBlock(Number(stable.blockNumber));
      if (!block?.hash) throw new Error('Timestamp block is unavailable.');
      return {
        state: 'confirmed',
        proof: {
          blockNumber: stable.blockNumber.toString(),
          blockHash: block.hash.toLowerCase(),
          timestamp: new Date(block.timestamp * 1000).toISOString(),
        },
      };
    },
    /**
     * Sign the commitment and the timestamp, with consecutive nonces, without broadcasting.
     *
     * @param digest - Expected lowercase digest.
     * @returns Both serialized signed transactions, their hashes and the timestamp's nonce.
     * @throws Error for invalid chain/intent; signing or provider errors.
     * @remarks The caller sends nothing else from this key until both are on chain.
     */
    async prepare(digest) {
      await network();
      const salt = hexlify(randomBytes(32));
      const commit = await signer.populateTransaction({
        to: contract,
        data: commitData(commitmentOf(digest, salt)),
        value: 0n,
        chainId,
        type: 0,
        gasLimit,
        gasPrice,
      });
      const reveal = { ...commit, data: revealData(digest, salt), nonce: Number(commit.nonce) + 1 };
      const commitRaw = (await signer.signTransaction(commit)).toLowerCase();
      const raw = (await signer.signTransaction(reveal)).toLowerCase();
      const signed = {
        raw,
        hash: keccak256(raw),
        nonce: String(reveal.nonce),
        commitRaw,
        commitHash: keccak256(commitRaw),
      };
      validate(digest, signed);
      return signed;
    },
    /**
     * Send the stored commitment, wait for it to mature, then send the stored timestamp; a
     * retry continues where the last attempt stopped.
     *
     * @param digest - Expected lowercase digest.
     * @param signed - Durable signed transactions.
     * @returns Completion once the timestamp is sent and, within the wait, mined.
     * @throws Error for wrong chain, mismatched intent, a failed commitment or a commitment that
     * has not matured within the wait; RPC errors.
     */
    async broadcast(digest, signed) {
      await network();
      const salt = validate(digest, signed);
      const deadline = Date.now() + waitMs;
      let committedAt = Number(
        await reader.getTimestampCommitmentBlock(signerAddress, commitmentOf(digest, salt)),
      );
      if (!committedAt) {
        await send(signed.commitRaw, signed.commitHash);
        const receipt = await provider!.waitForTransaction(signed.commitHash, 1, waitMs);
        if (!receipt) throw new Error('The timestamp commitment is not mined yet.');
        if (receipt.status !== 1) throw new Error('The timestamp commitment failed.');
        committedAt = receipt.blockNumber;
      }
      // Accepted from the block `maturity` blocks after the commitment's: send once the chain
      // is one block short of it.
      await reach(committedAt + maturity - 1, deadline);
      await send(signed.raw, signed.hash);
      await provider!
        .waitForTransaction(signed.hash, 1, Math.max(1000, deadline - Date.now()))
        .catch(() => null);
    },
  };
}
