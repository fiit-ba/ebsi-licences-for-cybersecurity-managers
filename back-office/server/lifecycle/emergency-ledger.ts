import { Contract, getAddress, ZeroAddress } from 'ethers';
import type { Provider, Signer } from 'ethers';

/** Immutable certificate and reason bindings for one emergency suspension. */
export interface EmergencyRecord {
  statusKey: string;
  credentialId: string;
  issuerDid: string;
  credentialHash: string;
  reasonHash: string;
}

/** Pinned emergency-suspension deployment and confirmed delivery operation. */
export interface EmergencyLedger {
  chainId: number;
  contract: string;
  suspend(record: EmergencyRecord): Promise<void>;
}

const abi = [
  'function certificateStatus(bytes32 statusKey) view returns (tuple(uint8 standing, uint64 validFrom, uint64 validUntil, uint64 registeredAt, uint64 changedAt, bytes32 credentialHash, string issuerDid))',
  'function suspendNow(bytes32 statusKey, bytes32 reasonHash)',
  'event CertificateStandingChanged(bytes32 indexed statusKey, uint8 standing, uint256 indexed proposalId, bytes32 reasonHash, address indexed by)',
];

/**
 * Create emergency suspension delivery with exact historical-event recovery.
 *
 * @param options - Chain, certificate registry, read provider, the issuing TI's signer,
 * deployment block, confirmation depth and timeout.
 * @returns The pinned deployment and suspend operation.
 * @throws Error for invalid deployment, signer or confirmation configuration.
 */
export function emergencyLedger(options: {
  chainId: number;
  address: string;
  provider: Provider;
  signerFor(issuerDid: string): Promise<Signer>;
  fromBlock?: number;
  confirmations?: number;
  timeoutMs?: number;
}): EmergencyLedger {
  const {
    chainId,
    address,
    provider,
    signerFor,
    fromBlock = 0,
    confirmations = 1,
    timeoutMs = 30_000,
  } = options;

  const contract = getAddress(address);
  if (
    !provider ||
    contract === ZeroAddress ||
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error('Invalid emergency ledger configuration.');
  const reader = new Contract(contract, abi, provider);

  /**
   * Read a certificate and require its immutable identity to match.
   *
   * @param record - Expected emergency certificate binding.
   * @param blockTag - Block at which to read.
   * @returns The standing code from the matching certificate ledger record.
   * @throws Error for a certificate mismatch; RPC errors.
   */
  async function standing(record: EmergencyRecord, blockTag: number | 'latest') {
    const value = await reader.certificateStatus(record.statusKey, { blockTag });
    if (
      value.standing === 0n ||
      value.issuerDid !== record.issuerDid ||
      value.credentialHash.toLowerCase() !== record.credentialHash.toLowerCase()
    ) {
      throw new Error('The emergency certificate does not match the governance ledger.');
    }
    return value.standing as bigint;
  }

  /**
   * Find a stable event proving this exact emergency reason was delivered.
   *
   * @param record - Expected certificate, commitment and reason hash.
   * @returns Whether this suspension is confirmed or the certificate is stably terminally revoked.
   * @throws Error for inconsistent certificate data; RPC errors.
   */
  async function confirmed(record: EmergencyRecord) {
    const block = (await provider!.getBlockNumber()) - confirmations + 1;
    if (block < fromBlock) return false;
    const value = await standing(record, block);
    // Revocation is terminal. Another party's temporary suspension is not
    // evidence of this request; only its own reason event can complete it.
    if (value === 3n && (await standing(record, 'latest')) === 3n) return true;

    // A unique salted reason identifies this emergency across process restarts.
    // Its confirmed event remains sufficient after a later reinstatement.
    const filter = reader.filters.CertificateStandingChanged(record.statusKey, null, 0);
    for (let start = fromBlock; start <= block; start += 2000) {
      const events = await reader.queryFilter(filter, start, Math.min(start + 1999, block));
      if (
        events.some(
          (event) =>
            'args' in event &&
            event.args.standing === 2n &&
            event.args.reasonHash.toLowerCase() === record.reasonHash.toLowerCase(),
        )
      )
        return true;
    }
    return false;
  }

  return {
    chainId,
    contract,
    /**
     * Deliver an emergency once or reconcile its exact previously confirmed event.
     *
     * @param record - Expected certificate identity, commitment and reason hash.
     * @returns Completion after confirmed delivery.
     * @throws Error for wrong network/authority, conflicting identity or absent confirmations;
     * signer/RPC errors.
     */
    async suspend(record) {
      if ((await provider!.getNetwork()).chainId !== BigInt(chainId))
        throw new Error('Emergency ledger chain ID does not match.');
      if (await confirmed(record)) return;
      if ((await standing(record, 'latest')) !== 1n)
        throw new Error('The emergency is awaiting confirmations.');
      try {
        const writer = new Contract(contract, abi, await signerFor(record.issuerDid));
        const tx = await writer.suspendNow(record.statusKey, record.reasonHash);
        const receipt = await tx.wait(confirmations, timeoutMs);
        if (!receipt || receipt.status !== 1 || !(await confirmed(record))) {
          throw new Error('The emergency suspension has not been confirmed.');
        }
      } catch (error) {
        if (await confirmed(record)) return;
        throw error;
      }
    },
  };
}
