import {
  AbiCoder,
  Contract,
  getAddress,
  Interface,
  isError,
  keccak256,
  toUtf8Bytes,
  type Provider,
  type Signer,
} from 'ethers';
import type { Pool } from 'pg';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../../shared/governance-contract.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';

/** A TAO's certificate registry and governance contract, and where reading their events starts. */
export interface TaoContracts {
  taoId: string;
  taoDid: string;
  governance: string;
  registry: string;
  block: number;
}

/** A contract template in EBSI's Proxy Templates Registry: its name and version. */
export interface ContractTemplate {
  name: string;
  version: string;
}

/** The templates a TAO's pair is deployed from. */
export interface ContractTemplates {
  registry: ContractTemplate;
  governance: ContractTemplate;
}

/** EBSI's Proxy Factory, as far as deploying and recognising a TAO's pair needs it. */
export const PROXY_FACTORY_ABI = [
  'function deployProxyWithSalt(string templateName, string templateVersion, bytes initData, string deployerDID, bytes32 salt, address owner) returns (address)',
  'function computeAddress(string templateName, string templateVersion, bytes initData, bytes32 salt, address owner, address deployer) view returns (address)',
  'function getDeploymentInfo(address contractAddress) view returns (tuple(bytes32 templateId, address deployer, uint256 deploymentTimestamp, bool isActive, string deployerDID, address owner))',
];

/**
 * A template's id in EBSI's Proxy Templates Registry.
 * @param template - Its name and version.
 * @returns keccak256(abi.encode(name, version)).
 */
export function templateId(template: ContractTemplate) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['string', 'string'], [template.name, template.version]),
  );
}

/**
 * Read `PLR_CONTRACT_TEMPLATES`: the registry's and the governance contract's templates.
 * @param value - `CertificateRegistry@1,CertificateGovernance@1` (the default when unset).
 * @returns The two templates.
 * @throws Error for another form.
 */
export function contractTemplates(value: string | undefined): ContractTemplates {
  const parts = (value?.trim() || 'CertificateRegistry@1,CertificateGovernance@1')
    .split(',')
    .map((part) => /^([A-Za-z][A-Za-z0-9_-]{0,63})@([A-Za-z0-9._-]{1,32})$/.exec(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !part))
    throw new Error('PLR_CONTRACT_TEMPLATES must be <registry>@<version>,<governance>@<version>.');
  const [registry, governance] = parts.map((part) => ({ name: part![1], version: part![2] }));
  return { registry, governance };
}

/**
 * Whether EBSI's Proxy Factory deployed a contract and keeps it active: a Trusted Contract, which
 * a `ledger:invoke` token is presented for. A TAO's pair is one before the back-office records it.
 * @param provider - Read provider.
 * @param factory - EBSI's Proxy Factory.
 * @returns The test; a contract once found trusted is remembered.
 */
export function factoryDeployments(provider: Provider, factory: string) {
  const reader = new Contract(getAddress(factory), PROXY_FACTORY_ABI, provider);
  const trusted = new Set<string>();
  return async (address: string) => {
    if (trusted.has(address)) return true;
    try {
      const info = await reader.getDeploymentInfo(address);
      if (info.isActive === true && /^0x0*[1-9a-f]/i.test(String(info.templateId)))
        trusted.add(address);
    } catch {
      // Not a deployment of the factory.
    }
    return trusted.has(address);
  };
}

const rowColumns = `tao.id AS tao_id, tao.did AS tao_did, tao.governance_contract,
  tao.certificate_registry, tao.contracts_block`;

/**
 * Turn a TAO row into its pair.
 * @param row - The row, or none.
 * @returns The pair, or undefined while the TAO has none.
 */
function pairOf(row: Record<string, unknown> | undefined): TaoContracts | undefined {
  if (!row?.governance_contract || !row.certificate_registry) return undefined;
  return {
    taoId: String(row.tao_id),
    taoDid: String(row.tao_did),
    governance: getAddress(String(row.governance_contract)),
    registry: getAddress(String(row.certificate_registry)),
    block: Number(row.contracts_block ?? 0),
  };
}

/** A pair deployed for its TAO outside the back-office: the installation's first, by `Deploy.s.sol`. */
export interface ExistingPair {
  governance: string;
  registry: string;
  block?: number;
}

/**
 * Where each TAO's pair is: one certificate registry and governance contract serve every TI of a
 * TAO, so anything about a certificate or a TI goes to its TAO's pair. A pair deployed beforehand
 * (`PLR_GOVERNANCE_CONTRACT`, `PLR_CERTIFICATE_REGISTRY`) is the pair of the TAO its governance
 * contract names; the pairs the back-office deploys are recorded on their TAOs.
 * @param database - Installation pool.
 * @param options - The pair deployed beforehand and a provider to read it, if there is one.
 * @returns Lookups by TAO, by an organization of it, by issuer DID and by contract.
 */
export function taoContractDirectory(
  database: Pool,
  options: { existing?: ExistingPair; provider?: Provider } = {},
) {
  let existingTao: Promise<string | undefined> | undefined;

  /**
   * The TAO the pair deployed beforehand serves.
   * @returns Its DID, or undefined without a usable pair.
   */
  function taoOfExisting() {
    const { existing, provider } = options;
    if (!existing || !provider) return Promise.resolve(undefined);
    existingTao ??= (async () => {
      const governance = new Contract(existing.governance, GOVERNANCE_ABI, provider);
      const registry = new Contract(existing.registry, REGISTRY_ABI, provider);
      if (getAddress(await registry.governance()) !== getAddress(existing.governance))
        return undefined;
      return String(await governance.taoDid());
    })().catch((error) => {
      existingTao = undefined;
      if (isError(error, 'CALL_EXCEPTION')) return undefined;
      throw error;
    });
    return existingTao;
  }

  /**
   * The pair deployed beforehand, as the pair of the TAO it serves. It is never written to the
   * database: a lookup can run inside a transaction that holds the TAO's row.
   * @param taoId - That TAO's id.
   * @param taoDid - Its DID.
   * @returns The pair.
   */
  function existingOf(taoId: string, taoDid: string): TaoContracts {
    return {
      taoId,
      taoDid,
      governance: getAddress(options.existing!.governance),
      registry: getAddress(options.existing!.registry),
      block: options.existing!.block ?? 0,
    };
  }

  /**
   * A TAO's recorded pair, or the pair deployed beforehand when it is the TAO's.
   * @param row - The TAO's row.
   * @returns Its pair, or undefined.
   */
  async function resolved(row: Record<string, unknown> | undefined) {
    if (!row) return undefined;
    const pair = pairOf(row);
    if (pair || !options.existing || !row.tao_did) return pair;
    if ((await taoOfExisting()) !== row.tao_did) return undefined;
    return existingOf(String(row.tao_id), String(row.tao_did));
  }

  /**
   * The pair deployed beforehand, when a live TAO of this installation is the one it serves.
   * @returns The pair, or undefined.
   */
  async function existingPair() {
    const taoDid = options.existing ? await taoOfExisting() : undefined;
    if (!taoDid) return undefined;
    const {
      rows: [tao],
    } = await database.query(
      "SELECT id FROM accredited_organizations WHERE kind='tao' AND did=$1 AND revoked_at IS NULL",
      [taoDid],
    );
    return tao ? existingOf(String(tao.id), taoDid) : undefined;
  }

  return {
    /**
     * A TAO's pair, or its TI's TAO's.
     * @param organizationId - TAO or TI organization UUID.
     * @returns The pair, or undefined while the TAO has none.
     */
    async ofOrganization(organizationId: string) {
      const { rows } = await database.query(
        `SELECT ${rowColumns} FROM accredited_organizations o
         JOIN accredited_organizations tao ON tao.id = CASE WHEN o.kind='ti' THEN o.parent_id ELSE o.id END
         WHERE o.id=$1 AND tao.kind='tao'`,
        [organizationId],
      );
      return resolved(rows[0]);
    },
    /**
     * The pair a TI's certificates are recorded in.
     * @param issuerDid - The TI's DID.
     * @returns Its TAO's pair, or undefined.
     */
    async ofIssuer(issuerDid: string) {
      const { rows } = await database.query(
        `SELECT ${rowColumns} FROM accredited_organizations ti
         JOIN accredited_organizations tao ON tao.id=ti.parent_id AND tao.kind='tao'
         WHERE ti.did=$1 AND ti.kind='ti' ORDER BY ti.revoked_at NULLS FIRST LIMIT 1`,
        [issuerDid],
      );
      return resolved(rows[0]);
    },
    /**
     * The pair a contract belongs to.
     * @param address - A registry or governance address.
     * @returns The pair, or undefined for a contract of no TAO here.
     */
    async byContract(address: string) {
      const { rows } = await database.query(
        `SELECT ${rowColumns} FROM accredited_organizations tao
         WHERE tao.kind='tao' AND (lower(tao.governance_contract)=lower($1) OR lower(tao.certificate_registry)=lower($1))`,
        [address],
      );
      const recorded = pairOf(rows[0]);
      if (recorded || !options.existing) return recorded;
      const existing = await existingPair();
      return existing &&
        [existing.governance, existing.registry].some(
          (contract) => contract.toLowerCase() === address.toLowerCase(),
        )
        ? existing
        : undefined;
    },
    /**
     * Every TAO's recorded pair.
     * @returns The pairs.
     */
    async all() {
      const { rows } = await database.query(
        `SELECT ${rowColumns} FROM accredited_organizations tao
         WHERE tao.kind='tao' AND tao.governance_contract IS NOT NULL ORDER BY tao.contracts_recorded_at`,
      );
      const pairs = rows.map((row) => pairOf(row)!);
      const existing = await existingPair();
      if (existing && !pairs.some((pair) => pair.governance === existing.governance))
        pairs.unshift(existing);
      return pairs;
    },
  };
}

/** Lookups of each TAO's pair. */
export type TaoContractDirectory = ReturnType<typeof taoContractDirectory>;

const registryInterface = new Interface(REGISTRY_ABI);
const governanceInterface = new Interface(GOVERNANCE_ABI);

/**
 * Deploy a TAO's pair through EBSI's Proxy Factory, from the registered templates, the first time
 * the TAO needs it. The RootTAO deploys (it holds the `ProxyFactory:deployProxy` policy), the
 * TAO's own key owns both contracts and points the registry at its governance. Addresses come
 * from the TAO's DID (CREATE2), so an interrupted deployment resumes where it stopped.
 * @param database - Installation pool.
 * @param options - Provider, factory, templates, the RootTAO's deploying key and DID, the TAO's
 * owning key, and a pair deployed for its TAO beforehand (the installation's first, by
 * `Deploy.s.sol`), recorded rather than deployed again.
 * @returns `ensure(taoId)`, the TAO's pair once it exists.
 */
export function taoContractDeployment(
  database: Pool,
  options: {
    provider: Provider;
    factory: string;
    templates: ContractTemplates;
    deployer(): Promise<{ signer: Signer; did: string }>;
    owner(taoId: string): Promise<Signer>;
    existing?: ExistingPair;
  },
) {
  const directory = taoContractDirectory(database, {
    existing: options.existing,
    provider: options.provider,
  });
  const factory = new Contract(getAddress(options.factory), PROXY_FACTORY_ABI, options.provider);

  /**
   * Record a TAO's pair.
   * @param tao - The TAO's id and DID.
   * @param pair - Its contracts and first block.
   * @param deployed - Whether the back-office deployed it now.
   * @returns The recorded pair.
   */
  async function record(
    tao: { id: string; did: string },
    pair: { governance: string; registry: string; block: number },
    deployed: boolean,
  ) {
    await transaction(database, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE accredited_organizations SET governance_contract=$2, certificate_registry=$3,
           contracts_block=$4, contracts_recorded_at=clock_timestamp()
         WHERE id=$1 AND kind='tao' AND governance_contract IS NULL`,
        [tao.id, pair.governance, pair.registry, pair.block],
      );
      if (rowCount)
        await appendAudit(client, {
          event: 'organization.contracts_recorded',
          organizationId: tao.id,
          detail: { governance: pair.governance, registry: pair.registry, deployed },
        });
    });
    return (await directory.ofOrganization(tao.id))!;
  }

  /**
   * Deploy one proxy unless it exists.
   * @param deployer - The deploying key and DID.
   * @param template - Its template.
   * @param initData - Its initializer call.
   * @param salt - Its CREATE2 salt.
   * @param owner - The proxy's owner.
   * @returns Its address and the block it was deployed in, if now.
   */
  async function proxy(
    deployer: { signer: Signer; did: string },
    template: ContractTemplate,
    initData: string,
    salt: string,
    owner: string,
  ) {
    const address = getAddress(
      await factory.computeAddress(
        template.name,
        template.version,
        initData,
        salt,
        owner,
        await deployer.signer.getAddress(),
      ),
    );
    if ((await options.provider.getCode(address)) !== '0x') return { address, block: undefined };
    const sent = await (factory.connect(deployer.signer) as Contract).deployProxyWithSalt(
      template.name,
      template.version,
      initData,
      deployer.did,
      salt,
      owner,
    );
    const receipt = await sent.wait(1, 120_000);
    if (!receipt || receipt.status !== 1) throw new Error(`${template.name} was not deployed.`);
    return { address, block: receipt.blockNumber as number };
  }

  return {
    directory,
    /**
     * The TAO's pair, deployed first if it has none.
     * @param taoId - TAO organization UUID.
     * @returns Its pair.
     * @throws Error for an unknown TAO; factory, KMS, RPC or database errors.
     */
    async ensure(taoId: string): Promise<TaoContracts> {
      const known = await directory.ofOrganization(taoId);
      if (known && known.taoId === taoId) return known;
      const lock = await database.connect();
      try {
        await lock.query('SELECT pg_advisory_lock(651905,hashtext($1))', [taoId]);
        const {
          rows: [tao],
        } = await lock.query(
          `SELECT id,did,governance_contract FROM accredited_organizations WHERE id=$1 AND kind='tao'`,
          [taoId],
        );
        if (!tao?.did) throw new Error('No TAO with a DID to deploy contracts for.');
        if (tao.governance_contract) return (await directory.ofOrganization(taoId))!;
        const start = await options.provider.getBlockNumber();
        const deployer = await options.deployer();
        const ownerSigner = await options.owner(taoId);
        const owner = await ownerSigner.getAddress();
        const salt = (kind: string) =>
          keccak256(toUtf8Bytes(`PLR-TAO-CONTRACTS-V1|${kind}|${tao.did}`));
        const registry = await proxy(
          deployer,
          options.templates.registry,
          registryInterface.encodeFunctionData('initialize', [owner]),
          salt('registry'),
          owner,
        );
        const governance = await proxy(
          deployer,
          options.templates.governance,
          governanceInterface.encodeFunctionData('initialize', [owner, tao.did, registry.address]),
          salt('governance'),
          owner,
        );
        const registryContract = new Contract(registry.address, REGISTRY_ABI, ownerSigner);
        if (getAddress(await registryContract.governance()) !== governance.address) {
          const sent = await registryContract.setGovernance(governance.address);
          const receipt = await sent.wait(1, 120_000);
          if (!receipt || receipt.status !== 1)
            throw new Error('The registry was not pointed at its governance.');
        }
        return record(
          tao,
          {
            governance: governance.address,
            registry: registry.address,
            block: Math.min(start, registry.block ?? start, governance.block ?? start),
          },
          true,
        );
      } finally {
        try {
          await lock.query('SELECT pg_advisory_unlock(651905,hashtext($1))', [taoId]);
        } finally {
          lock.release();
        }
      }
    },
  };
}

/** Deploying and recording each TAO's pair. */
export type TaoContractDeployment = ReturnType<typeof taoContractDeployment>;
