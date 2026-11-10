import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  AbstractSigner,
  Transaction,
  getAddress,
  type Signer,
  type Provider,
  type TransactionRequest,
  type TransactionLike,
} from 'ethers';
import type { Pool } from 'pg';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../../shared/governance-contract.ts';
import { Interface } from 'ethers';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';

/** Attribution supplied by a trusted governance owner, never by arbitrary signing input. */
interface SigningContext {
  actor: number;
  adminId?: string;
  proposalId?: string;
  credentialId?: string;
}
const signingContext = new AsyncLocalStorage<SigningContext>();

/**
 * Bind signatures to the human and case that authorized the existing governance operation.
 * @param context - Trusted actor and optional local/admin case identity.
 * @param work - Domain-approved transaction operation.
 * @returns The operation result with signature attribution propagated across async calls.
 * @throws Errors from the supplied operation.
 */
export function withGovernanceSigning<T>(
  context: SigningContext,
  work: () => Promise<T>,
): Promise<T> {
  return signingContext.run(context, work);
}

const interfaces = {
  governance: new Interface(GOVERNANCE_ABI),
  registry: new Interface(REGISTRY_ABI),
};
/** The deployments a signer may call: the governance contract and its certificate registry. */
export interface GovernanceDeployment {
  governance: string;
  registry: string;
}
/** Which contract each signable function belongs to. */
const functions: Record<string, keyof typeof interfaces> = {
  proposeAction: 'governance',
  signProposal: 'governance',
  execute: 'governance',
  cancelProposal: 'governance',
  expireProposal: 'governance',
  proposeAddSigner: 'governance',
  proposeRemoveSigner: 'governance',
  proposeReplaceSigner: 'governance',
  proposePolicy: 'governance',
  proposeProposalTtl: 'governance',
  signAdminProposal: 'governance',
  executeAdminProposal: 'governance',
  cancelAdminProposal: 'governance',
  expireAdminProposal: 'governance',
  addTi: 'governance',
  setTiAttribute: 'governance',
  setCosigners: 'governance',
  registerCertificate: 'registry',
  suspendNow: 'registry',
};

/**
 * Decode a transaction's call against the deployment it targets.
 * @param deployment - Pinned governance and registry addresses.
 * @param to - Transaction target.
 * @param data - Calldata.
 * @returns The decoded call and which contract it targets, or undefined for anything else.
 */
export function decodeGovernanceCall(deployment: GovernanceDeployment, to: string, data: string) {
  const target = getAddress(to);
  const kind =
    target === getAddress(deployment.governance)
      ? 'governance'
      : target === getAddress(deployment.registry)
        ? 'registry'
        : undefined;
  if (!kind) return undefined;
  try {
    const call = interfaces[kind].parseTransaction({ data });
    return call && functions[call.name] === kind ? { kind, call } : undefined;
  } catch {
    return undefined;
  }
}

/** Previously committed signing authorization, containing only public transaction data. */
interface Intent {
  id: string;
  actor_id: number | null;
  admin_proposal_id: string | null;
  key_purpose: string;
  key_id: string;
  signer_address: string;
  chain_id: string;
  contract: string;
  contract_function: string;
  calldata: string;
  expires_at: Date;
  consumed_at: Date | null;
  raw_transaction: string | null;
  transaction_hash: string | null;
  payload_digest: string | null;
}

/**
 * Verify that retained signed bytes still match their consumed authorization and digest.
 * @param intent - Consumed signing intent from the trusted store.
 * @returns The exact verified signed transaction.
 * @throws Error for tampering, missing signature or inconsistent purpose/deployment metadata.
 */
export function verifySignedIntent(intent: Intent) {
  if (!intent.consumed_at || !intent.raw_transaction)
    throw new Error('No consumed signature evidence exists.');
  const signed = Transaction.from(intent.raw_transaction);
  const kind = functions[intent.contract_function];
  let decoded;
  try {
    decoded = kind ? interfaces[kind].parseTransaction({ data: signed.data }) : null;
  } catch {
    decoded = null;
  }
  if (
    !signed.signature ||
    signed.type !== 2 ||
    signed.hash !== intent.transaction_hash ||
    signed.unsignedHash !== intent.payload_digest ||
    signed.from !== intent.signer_address ||
    signed.chainId !== BigInt(intent.chain_id) ||
    signed.to !== getAddress(intent.contract) ||
    signed.value !== 0n ||
    signed.data !== intent.calldata ||
    decoded?.name !== intent.contract_function
  )
    throw new Error('The retained signature does not match its consumed intent.');
  return signed;
}

/**
 * Create exact, one-time signing intents independently of transaction construction.
 * @param database - PostgreSQL pool storing one-time signing intents.
 * @param options - Dedicated role key, pinned deployment and KMS transaction signer.
 * @returns Intent creation, one-time signing and durable submission operations.
 * @remarks An internal caller authorizes function/arguments after its own domain checks.
 * Only purpose-bound transaction signing is available; no public arbitrary signing API is exposed.
 */
export function postgresLedgerSigning(
  database: Pool,
  options: {
    signer: Signer;
    keyId: string;
    purpose: string;
    chainId: number;
    deployment: GovernanceDeployment;
  },
) {
  const { signer, keyId, purpose, chainId, deployment } = options;
  /**
   * The pinned address a function is sent to.
   * @param functionName - Signable function.
   * @returns The governance or registry address.
   * @throws Error for an unsupported function.
   */
  function contractFor(functionName: string) {
    const kind = functions[functionName];
    if (!kind) throw new Error('Unsupported governance signing function.');
    return getAddress(deployment[kind]);
  }
  return {
    /**
     * Record one exact authorized contract call before requesting a transaction signature.
     * @param requestKey - Durable domain-operation identity reused after a lost response.
     * @param functionName - Existing governance function selected by the domain owner.
     * @param args - Exact validated ABI arguments.
     * @returns Existing or newly committed intent UUID.
     * @throws Error for unsupported calls, conflicting request reuse or DB/signer errors.
     */
    async create(requestKey: string, functionName: string, args: readonly unknown[]) {
      const contract = contractFor(functionName);
      const calldata = interfaces[functions[functionName]].encodeFunctionData(functionName, args);
      const address = await signer.getAddress();
      return transaction(database, async (client) => {
        await client.query(
          `INSERT INTO ledger_signing_intents(request_key,key_purpose,key_id,signer_address,chain_id,contract,contract_function,calldata,actor_id,admin_proposal_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(request_key) DO NOTHING`,
          [
            requestKey,
            purpose,
            keyId,
            address,
            chainId,
            contract,
            functionName,
            calldata,
            signingContext.getStore()?.actor ?? null,
            signingContext.getStore()?.adminId ?? null,
          ],
        );
        const row = (
          await client.query<Intent>(
            'SELECT * FROM ledger_signing_intents WHERE request_key=$1 FOR UPDATE',
            [requestKey],
          )
        ).rows[0];
        if (
          row.key_purpose !== purpose ||
          row.key_id !== keyId ||
          row.signer_address !== address ||
          Number(row.chain_id) !== chainId ||
          row.contract !== contract ||
          row.calldata !== calldata
        )
          throw new Error('The signing request was reused for another transaction.');
        return row.id;
      });
    },
    /**
     * Validate and sign an exact unsigned EIP-1559 transaction once, auditing success/refusal.
     * @param id - Committed intent UUID.
     * @param request - Transaction built for that intent; gas and nonce remain transport fields.
     * @returns Persisted signed raw transaction bytes.
     * @throws Error for missing, expired, consumed or mismatched intents/transactions; KMS or DB errors.
     */
    async sign(id: string, request: TransactionRequest) {
      let refused = false;
      try {
        return await transaction(database, async (client) => {
          const intent = (
            await client.query<Intent>(
              'SELECT * FROM ledger_signing_intents WHERE id=$1 FOR UPDATE',
              [id],
            )
          ).rows[0];
          refused = true;
          const { from: suppliedSender, ...plain } = request;
          const unsigned = request instanceof Transaction ? request : plain;
          const tx = Transaction.from(unsigned as TransactionLike);
          const contract = intent ? contractFor(intent.contract_function) : undefined;
          refused =
            !intent ||
            Boolean(intent.consumed_at) ||
            +intent.expires_at <= Date.now() ||
            intent.key_id !== keyId ||
            intent.key_purpose !== purpose ||
            intent.signer_address !== (await signer.getAddress()) ||
            tx.type !== 2 ||
            Boolean(tx.signature) ||
            tx.chainId !== BigInt(chainId) ||
            tx.to !== contract ||
            tx.value !== 0n ||
            tx.data !== intent.calldata ||
            (request.from !== undefined &&
              getAddress(String(request.from)) !== intent.signer_address);
          if (refused)
            throw new Error('The transaction does not match an unused live signing intent.');
          const raw = await signer.signTransaction(unsigned);
          const signed = Transaction.from(raw);
          if (signed.from !== intent.signer_address || signed.unsignedHash !== tx.unsignedHash)
            throw new Error('The signed transaction does not match its intent.');
          await client.query(
            `UPDATE ledger_signing_intents SET consumed_at=clock_timestamp(),payload_digest=$2,raw_transaction=$3,transaction_hash=$4 WHERE id=$1`,
            [id, tx.unsignedHash, raw, signed.hash],
          );
          await appendAudit(client, {
            event: 'ledger.tx_signed',
            actor: intent.actor_id ?? undefined,
            proposalId: signingContext.getStore()?.proposalId,
            credentialId: signingContext.getStore()?.credentialId,
            detail: {
              intent_id: id,
              key_id: keyId,
              key_purpose: purpose,
              contract_function: intent.contract_function,
              chain_id: chainId,
              payload_digest: tx.unsignedHash,
            },
          });
          return raw;
        });
      } catch (error) {
        if (refused)
          await transaction(database, (client) =>
            appendAudit(client, {
              event: 'ledger.tx_refused',
              actor: signingContext.getStore()?.actor,
              detail: { intent_id: id, key_purpose: purpose, refusal: 'intent_mismatch' },
            }),
          );
        throw error;
      }
    },
    /**
     * Resubmit the already signed transaction; never request a replacement signature after uncertainty.
     * @param id - Previously consumed intent UUID.
     * @returns Provider transaction response, including when it was mined before a lost reply.
     * @throws Error for missing signed bytes/provider; RPC errors.
     */
    async broadcast(id: string) {
      const intent = (
        await database.query<Intent>('SELECT * FROM ledger_signing_intents WHERE id=$1', [id])
      ).rows[0];
      if (!intent?.raw_transaction || !signer.provider)
        throw new Error('No signed transaction is available.');
      if (
        intent.key_id !== keyId ||
        intent.key_purpose !== purpose ||
        Number(intent.chain_id) !== chainId ||
        intent.contract !== contractFor(intent.contract_function)
      )
        throw new Error('The retained signature belongs to another key purpose or deployment.');
      const hash = verifySignedIntent(intent).hash!;
      const existing = await signer.provider.getTransaction(hash);
      if (existing) return existing;
      try {
        return await signer.provider.broadcastTransaction(intent.raw_transaction);
      } catch (error) {
        const observed = await signer.provider.getTransaction(hash);
        if (observed) return observed;
        throw error;
      }
    },
  };
}

/** Purpose-bound ledger signer that journals each outbound signature and retains uncertain bytes. */
class AuditedLedgerSigner extends AbstractSigner {
  readonly signer: Signer;
  readonly database: Pool;
  readonly options: {
    keyId: string;
    purpose: string;
    chainId: number;
    deployment: GovernanceDeployment;
  };
  #sending: Promise<unknown> = Promise.resolve();
  /**
   * Bind a dedicated KMS role key to the intent store and allowed deployment.
   * @param database - PostgreSQL pool.
   * @param signer - Dedicated underlying KMS signer.
   * @param options - Pinned purpose/key/deployment identity.
   */
  constructor(
    database: Pool,
    signer: Signer,
    options: { keyId: string; purpose: string; chainId: number; deployment: GovernanceDeployment },
  ) {
    super(signer.provider);
    this.database = database;
    this.signer = signer;
    this.options = options;
  }
  /**
   * Read the pinned dedicated KMS address.
   * @returns Verified dedicated KMS key address.
   */
  getAddress() {
    return this.signer.getAddress();
  }
  /**
   * Preserve purpose binding on the same provider only.
   * @param provider - Requested provider.
   * @returns This signer for the same provider.
   * @throws Error if changing providers would bypass deployment binding.
   */
  connect(provider: Provider | null) {
    if (provider !== this.provider) throw new Error('The audited signer is bound to its provider.');
    return this;
  }
  /**
   * Refuse arbitrary message signatures.
   * @returns Never returns successfully.
   * @throws Error because arbitrary messages are not authorized.
   */
  async signMessage(): Promise<never> {
    throw new Error('Only authorized ledger transactions may be signed.');
  }
  /**
   * Refuse typed-data signatures.
   * @returns Never returns successfully.
   * @throws Error because typed data is not authorized.
   */
  async signTypedData(): Promise<never> {
    throw new Error('Only authorized ledger transactions may be signed.');
  }
  /**
   * Reject callers bypassing the committed signing-intent operation.
   * @param request - Unused transaction request.
   * @returns Never returns successfully.
   * @throws Error because callers must use sendTransaction.
   */
  async signTransaction(request: TransactionRequest): Promise<never> {
    void request;
    throw new Error('Use the committed ledger signing intent.');
  }
  /**
   * Serialize signing and sending, committing signed bytes before the external broadcast.
   * @param request - Exact transaction from a trusted domain-selected contract call.
   * @returns The submitted or reconciled provider transaction response.
   * @throws Intent, signature, database or RPC errors.
   * @remarks A database session lock serializes the dedicated key across processes.
   * Uncertain signed bytes are retried before any new signature or nonce allocation.
   */
  sendTransaction(request: TransactionRequest) {
    const sending = this.#sending.then(async () => {
      const lock = await this.database.connect();
      const lockKey = this.options.chainId + ':' + (await this.signer.getAddress());
      try {
        await lock.query('SELECT pg_advisory_lock(780264154,hashtext($1))', [lockKey]);
        const intents = postgresLedgerSigning(this.database, {
          ...this.options,
          signer: this.signer,
        });
        const pending = await lock.query<Intent>(
          'SELECT * FROM ledger_signing_intents WHERE key_id=$1 AND chain_id=$2 AND consumed_at IS NOT NULL ORDER BY consumed_at DESC',
          [this.options.keyId, this.options.chainId],
        );
        for (const row of pending.rows) {
          const signed = Transaction.from(row.raw_transaction!);
          if (await this.provider!.getTransactionReceipt(signed.hash!)) break;
          const response = await intents.broadcast(row.id);
          if (
            row.contract === getAddress(String(request.to)) &&
            row.calldata === String(request.data) &&
            BigInt(request.value ?? 0) === 0n
          )
            return response;
          throw new Error('The previous role transaction is awaiting reconciliation.');
        }
        const populated = await this.signer.populateTransaction({ ...request, type: 2 });
        const decoded = decodeGovernanceCall(
          this.options.deployment,
          String(populated.to),
          String(populated.data),
        );
        if (!decoded || BigInt(populated.value ?? 0) !== 0n)
          throw new Error('Unapproved governance transaction.');
        const id = await intents.create(randomUUID(), decoded.call.name, [...decoded.call.args]);
        await intents.sign(id, populated);
        return await intents.broadcast(id);
      } finally {
        try {
          await lock.query('SELECT pg_advisory_unlock(780264154,hashtext($1))', [lockKey]);
        } finally {
          lock.release();
        }
      }
    });
    this.#sending = sending.catch(() => {});
    return sending;
  }
}

/**
 * Wrap a dedicated KMS ledger key with exact one-time intent checks and signature auditing.
 * @param database - PostgreSQL pool.
 * @param signer - Underlying pinned KMS key.
 * @param options - Key purpose and expected chain/contract.
 * @returns A transaction-only signer for the domain's trusted ABI callers.
 */
export function auditedLedgerSigner(
  database: Pool,
  signer: Signer,
  options: { keyId: string; purpose: string; chainId: number; deployment: GovernanceDeployment },
): Signer {
  return new AuditedLedgerSigner(database, signer, options);
}

/**
 * Remove only unused expired signing authorizations, retaining consumed signature evidence.
 * @param database - PostgreSQL pool.
 * @returns Number of deleted expired unused intents.
 * @throws Database errors.
 */
export async function purgeUnusedSigningIntents(database: Pool) {
  return (
    (
      await database.query(
        'DELETE FROM ledger_signing_intents WHERE consumed_at IS NULL AND expires_at<clock_timestamp()',
      )
    ).rowCount ?? 0
  );
}
