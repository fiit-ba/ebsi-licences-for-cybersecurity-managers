import { Contract, getAddress, ZeroAddress, type Provider, type Signer } from 'ethers';
import type { LedgerRegistration, LedgerStatus, CertificateLedger } from './types.ts';
import { certificateIdHash } from './protection.ts';

const abi = [
  'function certificateStatus(bytes32 statusKey) view returns (tuple(uint8 standing, uint64 validFrom, uint64 validUntil, uint64 registeredAt, uint64 changedAt, bytes32 credentialHash, string issuerDid))',
  'function registerCertificate(bytes32 certificateIdHash, string issuerDid, uint64 validFrom, uint64 validUntil, bytes32 credentialHash, uint8 standing) returns (bytes32)',
];
const standingCodes = { active: 1n, suspended: 2n, revoked: 3n };

/**
 * Compare the intended standing and every immutable field with a registry record.
 *
 * @param existing - Observed record.
 * @param record - Intended registration.
 * @returns Whether standing, TI, credential hash and validity all match.
 */
function matches(existing: LedgerStatus, record: LedgerRegistration) {
  return (
    existing.standing === standingCodes[record.standing ?? 'active'] &&
    existing.issuerDid === record.issuer &&
    existing.credentialHash.toLowerCase() === record.credentialHash.toLowerCase() &&
    existing.validFrom === BigInt(record.validFrom) &&
    existing.validUntil === BigInt(record.validUntil)
  );
}

/**
 * Create exact certificate registration and status access on the certificate registry.
 *
 * @param options - Chain ID, registry address, read provider, the issuing TI's signer,
 * confirmation count and receipt timeout.
 * @returns A ledger adapter exposing its deployment and status/registration operations.
 * @throws Error for invalid deployment configuration.
 * @remarks Registration is the TI's own act: one signature by one of its governance keys, which
 * the registry checks against the TI's live accreditation and its DID document.
 */
export function governanceLedger(options: {
  chainId: number;
  address: string;
  provider: Provider;
  signerFor(issuerDid: string): Promise<Signer>;
  confirmations?: number;
  timeoutMs?: number;
}): CertificateLedger {
  const { chainId, provider, signerFor, confirmations = 1, timeoutMs = 30_000 } = options;

  const contract = getAddress(options.address);
  if (
    contract === ZeroAddress ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error('A certificate registry and valid ledger configuration are required.');
  }
  const reader = new Contract(contract, abi, provider);

  /**
   * Check whether the exact intended certificate is already recorded.
   *
   * @param record - Expected record.
   * @param blockTag - Block at which to inspect it.
   * @returns Whether an exact record exists.
   * @throws Error for a conflicting record; RPC errors.
   */
  async function existingRegistration(
    record: LedgerRegistration,
    blockTag: string | number = 'latest',
  ) {
    const existing = await reader.certificateStatus(record.statusKey, { blockTag });
    if (existing.standing === 0n) return false;
    if (!matches(existing, record)) {
      throw new Error('The certificate registry already has a different record under this key.');
    }
    return true;
  }

  /**
   * Require the provider to serve the configured chain.
   *
   * @returns Completion when chain IDs match.
   * @throws Error for a different chain; RPC errors.
   */
  async function assertNetwork() {
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(chainId))
      throw new Error('Certificate registry chain ID does not match.');
  }

  return {
    chainId,
    contract,
    /**
     * Read a certificate's record.
     *
     * @param statusKey - Hex record key.
     * @returns The record; standing 0 when there is none.
     * @throws Error for wrong chain; RPC errors.
     */
    async status(statusKey: string) {
      await assertNetwork();
      return reader.certificateStatus(statusKey);
    },
    /**
     * Record a collected certificate, or reconcile its exact confirmed record.
     *
     * @param record - The collected credential's id, TI, key, hash and validity.
     * @returns Completion after a matching record reaches confirmation depth.
     * @throws Error for an invalid intended standing, wrong chain, conflicting records or
     * unconfirmed transactions; signer and RPC errors.
     */
    async ensureRegistered(record: LedgerRegistration) {
      if (!Object.hasOwn(standingCodes, record.standing ?? 'active'))
        throw new Error('The intended certificate standing is invalid.');
      await assertNetwork();
      // Require the same depth on retry as on first submission. With more
      // than one confirmation, an existing but still shallow record is pending.
      const head = await provider.getBlockNumber();
      const confirmedBlock = head - confirmations + 1;
      if (confirmedBlock >= 0 && (await existingRegistration(record, confirmedBlock))) {
        if (await existingRegistration(record)) return;
      }
      if (await existingRegistration(record))
        throw new Error('The certificate record is awaiting confirmations.');

      const writer = new Contract(contract, abi, await signerFor(record.issuer));
      try {
        const tx = await writer.registerCertificate(
          '0x' + certificateIdHash(record.id).toString('hex'),
          record.issuer,
          record.validFrom,
          record.validUntil,
          record.credentialHash,
          standingCodes[record.standing ?? 'active'],
        );
        const receipt = await tx.wait(confirmations, timeoutMs);
        if (
          !receipt ||
          receipt.status !== 1 ||
          !(await existingRegistration(record, receipt.blockNumber)) ||
          !(await existingRegistration(record))
        ) {
          throw new Error('The certificate registry did not confirm the record.');
        }
      } catch (error) {
        // Another worker may have won the race, or RPC may have lost the
        // response. Only reconcile to an exact record with enough confirmations.
        const currentHead = await provider.getBlockNumber();
        const block = currentHead - confirmations + 1;
        if (
          block >= 0 &&
          (await existingRegistration(record, block)) &&
          (await existingRegistration(record))
        )
          return;
        throw error;
      }
    },
  };
}
