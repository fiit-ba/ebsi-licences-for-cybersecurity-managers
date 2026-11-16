import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, copyFile, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  AbiCoder,
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  concat,
  encodeBase58,
  keccak256,
  randomBytes,
  sha256,
  toBeHex,
  toUtf8Bytes,
} from 'ethers';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../../../shared/governance-contract.ts';

const run = promisify(execFile);
const contracts = fileURLToPath(new URL('../../../../contracts/', import.meta.url));
const mnemonic = 'test test test test test test test test test test test junk';
/** The development keys of contracts/scripts/Networks.sol, by index. Public knowledge. */
const developmentKey = (index: number) =>
  HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${index}`);
const abi = AbiCoder.defaultAbiCoder();
/** SeedEbsi.s.sol's revision salt for first accreditations. */
const salt = keccak256(toUtf8Bytes('development'));

const didRegistryAbi = [
  'function insertDidDocument(string did, string baseDocument, string vMethodId, bytes publicKey, bool isSecp256k1, uint256 notBefore, uint256 notAfter) returns (bool)',
  'function addVerificationMethod(string did, string vMethodId, bytes publicKey, bool isSecp256k1) returns (bool)',
  'function addVerificationRelationship(string did, string name, string vMethodId, uint256 notBefore, uint256 notAfter) returns (bool)',
];
const issuersRegistryAbi = [
  'function setAttributeMetadata(string did, bytes32 revisionId, uint8 issuerType, string taoDid, bytes32 attributeIdTao)',
];

/** Where the test ledger is and what is deployed on it, as handed to each test process. */
export interface TestLedgerRecord {
  rpc: string;
  chainId: number;
  governance: string;
  registry: string;
  didRegistry: string;
  issuersRegistry: string;
  schemasRegistry: string;
  timestamp: string;
  policiesRegistry: string;
  taoDid: string;
  supervisorDid: string;
}

/** A TI's policies as addTi takes them: SUSPEND, REVOKE, REINSTATE and ADMIN. */
export interface TestPolicy {
  threshold: number;
  requiredRoleMask: number;
  vetoRoleMask: number;
  timelock: number;
}

/** The pilot rules (contracts/config/pilot.json): two of three roles, a 24 h revocation timelock. */
export const pilotPolicies: TestPolicy[] = [
  { threshold: 2, requiredRoleMask: 0, vetoRoleMask: 7, timelock: 0 },
  { threshold: 2, requiredRoleMask: 0, vetoRoleMask: 7, timelock: 86400 },
  { threshold: 2, requiredRoleMask: 0, vetoRoleMask: 7, timelock: 0 },
  { threshold: 2, requiredRoleMask: 0, vetoRoleMask: 7, timelock: 0 },
];

/**
 * A free local TCP port.
 * @returns The port number.
 */
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * Wait until a JSON-RPC endpoint answers with its chain id.
 * @param rpc - Endpoint.
 * @returns The chain id.
 * @throws Error when it does not answer in 30 s.
 */
async function chainIdOf(rpc: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      return Number((await response.json()).result);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/**
 * Hold contracts/deployments/.test-ledger while the scripts write their records there.
 * @param work - What to do while holding it.
 * @returns The work's result.
 */
async function exclusively<T>(work: () => Promise<T>) {
  const lock = join(contracts, 'deployments', '.test-ledger');
  await mkdir(join(contracts, 'deployments'), { recursive: true });
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  try {
    return await work();
  } finally {
    await rmdir(lock);
  }
}

/**
 * Start anvil and deploy what a development installation runs on, with the contracts' own
 * scripts: EBSI's registries (DeployEBSI.s.sol), the certificate registry and its governance
 * (Deploy.s.sol) and the development trust chain (SeedEbsi.s.sol). A developer's own anvil
 * records in contracts/deployments are put back afterwards.
 * @param options - The address anvil listens on (loopback by default; 0.0.0.0 for containers),
 * whether to seed the development trust chain (an installation that publishes its own
 * authorities, as `start-mvp.sh` deploys for, takes none), and the TAO DID the governance is
 * deployed for (Deploy.s.sol's development default otherwise).
 * @returns The record and the anvil process.
 * @throws Error without anvil or forge, or when a script fails.
 */
export async function startTestLedger(
  options: { host?: string; seed?: boolean; taoDid?: string } = {},
): Promise<{
  record: TestLedgerRecord;
  anvil: ChildProcess;
}> {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    'anvil',
    ['--host', options.host ?? '127.0.0.1', '--port', String(port), '--silent'],
    { stdio: 'ignore' },
  );
  const failed = new Promise<never>((_, reject) =>
    anvil.once('error', (error) => reject(new Error('anvil is required: ' + error.message))),
  );
  try {
    const chainId = await Promise.race([chainIdOf(rpc), failed]);
    const record = await exclusively(async () => {
      const records = ['anvil.json', 'anvil-ebsi.json'];
      const backup = await mkdtemp(join(tmpdir(), 'plr-test-ledger-'));
      for (const name of records)
        if (existsSync(join(contracts, 'deployments', name)))
          await copyFile(join(contracts, 'deployments', name), join(backup, name));
      try {
        const script = async (name: string, slow = false, env: NodeJS.ProcessEnv = {}) =>
          run(
            'forge',
            [
              'script',
              `scripts/${name}`,
              '--rpc-url',
              rpc,
              '--broadcast',
              ...(slow ? ['--slow'] : []),
            ],
            {
              cwd: contracts,
              env: { ...process.env, ...env },
              maxBuffer: 16 * 1024 * 1024,
              timeout: 600_000,
            },
          );
        await script('DeployEBSI.s.sol', true);
        await script(
          'Deploy.s.sol',
          false,
          options.taoDid ? { GOVERNANCE_TAO_DID: options.taoDid } : {},
        );
        const seeded = options.seed === false ? '' : (await script('SeedEbsi.s.sol', true)).stdout;
        const ebsi = JSON.parse(
          await readFile(join(contracts, 'deployments', 'anvil-ebsi.json'), 'utf8'),
        ).ebsi;
        const deployed = JSON.parse(
          await readFile(join(contracts, 'deployments', 'anvil.json'), 'utf8'),
        );
        return {
          rpc,
          chainId,
          governance: deployed.CertificateGovernance.address,
          registry: deployed.CertificateRegistry.address,
          didRegistry: ebsi.DidRegistry.contractAddress,
          issuersRegistry: ebsi.IssuersRegistry.contractAddress,
          schemasRegistry: ebsi.SchemasRegistry.contractAddress,
          timestamp: ebsi.Timestamp.contractAddress,
          policiesRegistry: ebsi.PolicyRegistry.contractAddress,
          taoDid: deployed.CertificateGovernance.taoDid,
          supervisorDid: /COSIGNER_DID=(\S+)/.exec(seeded)?.[1] ?? '',
        };
      } finally {
        for (const name of records) {
          await rm(join(contracts, 'deployments', name), { force: true });
          if (existsSync(join(backup, name)))
            await copyFile(join(backup, name), join(contracts, 'deployments', name));
        }
        await rm(backup, { recursive: true, force: true });
      }
    });
    // Blocks keep coming, as on Besu: anvil mines only on transactions, and a client waiting
    // for a confirmation block would otherwise wait on an idle chain.
    const ticker = setInterval(() => {
      fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }),
      }).catch(() => undefined);
    }, 1000);
    ticker.unref();
    anvil.once('exit', () => clearInterval(ticker));
    return { record, anvil };
  } catch (error) {
    anvil.kill();
    throw error;
  }
}

/**
 * Start the development EBSI service (infra/ebsi-mock) over a test ledger: EBSI's Core API v1
 * and its test fixtures (/__mock/seed, /__mock/did-keys, /__mock/revoke).
 * @param record - The test ledger.
 * @returns Its base URL and process.
 * @throws Error when it does not become ready in 60 s.
 */
export async function startTestEbsi(record: TestLedgerRecord) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const service = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../../../infra/ebsi-mock/src/server.js', import.meta.url))],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        QUIET: '1',
        MOCK_BASE_URL: base,
        MOCK_LEDGER_RPC_URL: record.rpc,
        MOCK_DID_REGISTRY: record.didRegistry,
        MOCK_ISSUERS_REGISTRY: record.issuersRegistry,
        MOCK_SCHEMAS_REGISTRY: record.schemasRegistry,
        MOCK_TIMESTAMP: record.timestamp,
        MOCK_POLICIES_REGISTRY: record.policiesRegistry,
        MOCK_INVOKE_CONTRACTS: [record.governance, record.registry].join(','),
        MOCK_SUPPORT_OFFICE_DID: 'did:ebsi:zSupport',
        // SeedEbsi.s.sol registered the supervisory authority already.
        MOCK_SUPERVISOR_DID: '',
      },
    },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(base + '/health')).ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline || service.exitCode !== null) {
      service.kill();
      throw new Error('The development EBSI service did not become ready.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { base, service };
}

/** One TI set up on the governance contract for a test: its DID, accreditation and A and B keys. */
export interface TestTi {
  did: string;
  attributeId: string;
  keys: [Wallet, Wallet];
}

/**
 * Connect to the test run's ledger, or start one for this process.
 * @returns The ledger: the record, a provider, the development TAO and supervisory authority keys,
 * and helpers that set up TIs, fund keys and move the chain's clock.
 */
async function connect() {
  let record: TestLedgerRecord;
  if (process.env.BACK_OFFICE_TEST_LEDGER) {
    record = JSON.parse(process.env.BACK_OFFICE_TEST_LEDGER);
  } else {
    const started = await startTestLedger();
    record = started.record;
    // A standalone test file owns this anvil; it must not keep the process alive.
    started.anvil.unref();
    process.once('exit', () => started.anvil.kill());
  }
  const provider = new JsonRpcProvider(record.rpc, record.chainId, {
    staticNetwork: true,
    cacheTimeout: -1,
  });
  const tao = developmentKey(4).connect(provider);
  const supervisor = developmentKey(5).connect(provider);
  const request = (method: string, params: unknown[] = []) => provider.send(method, params);
  /**
   * Give a key gas.
   * @param address - The key's address.
   * @returns Completion.
   */
  async function fund(address: string) {
    await request('anvil_setBalance', [address, toBeHex(10n ** 21n)]);
  }
  await fund(tao.address);
  await fund(supervisor.address);
  return {
    ...record,
    provider,
    tao,
    supervisor,
    fund,
    /**
     * Advance the chain's clock and mine a block.
     * @param seconds - How far.
     * @returns Completion.
     */
    async increaseTime(seconds: number) {
      await request('evm_increaseTime', [seconds]);
      await request('evm_mine');
    },
    /**
     * Mine blocks.
     * @param count - How many.
     * @returns Completion.
     */
    async mine(count = 1) {
      for (let i = 0; i < count; i++) await request('evm_mine');
    },
    /**
     * Register a fresh TI as SeedEbsi.s.sol registers the development one, and set it up on
     * the governance contract as the TAO: its DID with two keys, its accreditation by the TAO,
     * the supervisory authority as role C.
     * @param options - Optional policies and proposal lifetime.
     * @returns The TI.
     */
    async newTi(options: { policies?: TestPolicy[]; proposalTtl?: number } = {}): Promise<TestTi> {
      const keys: [Wallet, Wallet] = [
        new Wallet(Wallet.createRandom().privateKey, provider),
        new Wallet(Wallet.createRandom().privateKey, provider),
      ];
      for (const key of keys) await fund(key.address);
      const did = 'did:ebsi:z' + encodeBase58(concat(['0x01', randomBytes(16)]));
      const now = (await provider.getBlock('latest'))!.timestamp;
      const year = 365 * 86400;
      const didRegistry = new Contract(record.didRegistry, didRegistryAbi, keys[0]);
      await (
        await didRegistry.insertDidDocument(
          did,
          '{}',
          did + '#key-1',
          keys[0].signingKey.publicKey,
          true,
          now,
          now + year,
        )
      ).wait();
      await (
        await didRegistry.addVerificationMethod(
          did,
          did + '#key-2',
          keys[1].signingKey.publicKey,
          true,
        )
      ).wait();
      await (
        await didRegistry.addVerificationRelationship(
          did,
          'capabilityInvocation',
          did + '#key-2',
          now,
          now + year,
        )
      ).wait();
      const firstRevision = (subject: string) =>
        sha256(abi.encode(['string', 'bytes32', 'uint256', 'bytes'], [subject, salt, 0, '0x']));
      const issuers = new Contract(record.issuersRegistry, issuersRegistryAbi, tao);
      await (
        await issuers.setAttributeMetadata(
          did,
          salt,
          3,
          record.taoDid,
          firstRevision(record.taoDid),
        )
      ).wait();
      const attributeId = firstRevision(did);
      const governance = new Contract(record.governance, GOVERNANCE_ABI, tao);
      await (
        await governance.addTi({
          did,
          attributeId,
          signers: keys.map((key) => key.address),
          roles: [1, 2],
          cosigners: [{ did: record.supervisorDid, role: 3 }],
          policies: options.policies ?? pilotPolicies,
          proposalTtl: options.proposalTtl ?? 30 * 86400,
        })
      ).wait();
      return { did, attributeId, keys };
    },
    /**
     * Make a new key a valid key of a TI's DID (capabilityInvocation), as its controller does
     * before the key can be proposed as a signer.
     * @param ti - The TI.
     * @returns A funded wallet holding the new key.
     */
    async newTiKey(ti: TestTi) {
      const key = new Wallet(Wallet.createRandom().privateKey, provider);
      await fund(key.address);
      const vMethodId = ti.did + '#key-' + key.address.slice(2, 10).toLowerCase();
      const now = (await provider.getBlock('latest'))!.timestamp;
      const didRegistry = new Contract(record.didRegistry, didRegistryAbi, ti.keys[0]);
      await (
        await didRegistry.addVerificationMethod(ti.did, vMethodId, key.signingKey.publicKey, true)
      ).wait();
      await (
        await didRegistry.addVerificationRelationship(
          ti.did,
          'capabilityInvocation',
          vMethodId,
          now,
          now + 365 * 86400,
        )
      ).wait();
      return key;
    },
    /**
     * Record a further certificate of a TI on the certificate registry, as collection does.
     * @param ti - The TI.
     * @param id - The credential's `vc.id`; a fresh one by default.
     * @returns The record key.
     */
    async recordCertificate(ti: TestTi, id = 'urn:uuid:' + crypto.randomUUID()) {
      const idHash = sha256(abi.encode(['string', 'string'], ['PLR-CERTIFICATE-ID-V1', id]));
      const registry = new Contract(record.registry, REGISTRY_ABI, ti.keys[0]);
      await (await registry.registerCertificate(idHash, ti.did, 0, 0, sha256(idHash), 1)).wait();
      return sha256(
        abi.encode(['string', 'string', 'bytes32'], ['PLR-CERTIFICATE-V4', ti.did, idHash]),
      );
    },
    /** The governance contract, read-only. */
    governanceContract: new Contract(record.governance, GOVERNANCE_ABI, provider),
    /** The certificate registry, read-only. */
    registryContract: new Contract(record.registry, REGISTRY_ABI, provider),
  };
}

let shared: ReturnType<typeof connect> | undefined;

/**
 * The development ledger tests run against: the test run's (BACK_OFFICE_TEST_LEDGER, started
 * once by scripts/test-server.ts), or one started for this process.
 * @returns The connected ledger.
 */
export function testLedger() {
  shared ??= connect();
  return shared;
}

/** The connected test ledger. */
export type TestLedger = Awaited<ReturnType<typeof connect>>;
