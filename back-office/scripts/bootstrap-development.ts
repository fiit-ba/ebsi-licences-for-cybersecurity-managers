import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Contract, HDNodeWallet, JsonRpcProvider } from 'ethers';

const root = fileURLToPath(new URL('../../', import.meta.url));
const infra = join(root, 'infra');
/** The development TAO key the contracts are deployed with (contracts/scripts/Networks.sol, index 4). */
const developmentTao = HDNodeWallet.fromPhrase(
  'test test test test test test test test test test test junk',
  undefined,
  "m/44'/60'/0'/0/4",
);
const ownable = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner)',
];

/**
 * Hand both contracts to the TAO's KMS ledger key, once, as the development deployer's TAO.
 * @param rpc - Host-reachable development ledger.
 * @param addresses - Certificate registry and governance contract.
 * @param tao - The TAO's KMS ledger address.
 * @returns Completion when the TAO's key owns both.
 * @throws Error when another key owns a contract; RPC errors.
 */
async function handOver(rpc: string, addresses: string[], tao: string) {
  // No cached answers: on a ledger that mines at once, a cached transaction count would hand
  // the second transfer the first one's nonce.
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  try {
    const signer = developmentTao.connect(provider);
    for (const address of addresses) {
      const contract = new Contract(address, ownable, signer);
      const owner = await contract.owner();
      if (owner === tao) continue;
      if (owner !== signer.address)
        throw new Error(`${address} is owned by ${owner}, neither the development TAO nor ${tao}.`);
      const receipt = await (await contract.transferOwnership(tao)).wait(1, 120_000);
      if (!receipt || receipt.status !== 1) throw new Error('The ownership transfer failed.');
    }
  } finally {
    provider.destroy();
  }
}
const { values } = parseArgs({
  options: { 'env-file': { type: 'string' }, 'project-name': { type: 'string' } },
});
const compose = [
  'compose',
  ...(values['env-file'] ? ['--env-file', values['env-file']] : []),
  ...(values['project-name'] ? ['--project-name', values['project-name']] : []),
];

/**
 * Run an ordinary local bootstrap phase and report a bounded diagnostic on failure.
 * @param command - Executable, without shell interpolation.
 * @param args - Literal arguments for the owned setup operation.
 * @param options - Optional working directory, environment and captured JSON output.
 * @returns Captured public JSON when requested, otherwise an empty string.
 * @throws Command failures with bounded output, never a serialized environment or credential input.
 */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean; timeout?: number } = {},
) {
  try {
    return (
      execFileSync(command, args, {
        cwd: options.cwd ?? infra,
        env: options.env ?? process.env,
        encoding: 'utf8',
        timeout: options.timeout ?? 180_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      }) ?? ''
    );
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    throw new Error(String(failure.stderr ?? failure.message).slice(-3000));
  }
}

try {
  // Refuse hosted configuration before starting services or creating demonstration data.
  const config = JSON.parse(
    run('docker', [...compose, 'config', '--format', 'json'], { capture: true }),
  );
  if (config.services?.backend?.environment?.BACK_OFFICE_DEVELOPMENT !== 'true')
    throw new Error(
      'Use this bootstrap only with the ordinary development Compose. Hosted installations use bootstrap:admin.',
    );
  console.log('Waiting for database migrations, API, Redis, KMS and development registries…');
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '180', 'backend', 'worker']);
  console.log('Preparing demonstration accounts, hierarchy, schema, keys and EBSI publication…');
  // Publication is a few dozen KMS-signed ledger transactions, each waiting for its block.
  const publication = 900_000;
  const seeded = JSON.parse(
    run('docker', [...compose, 'exec', '-T', 'backend', 'node', 'scripts/seed-development.ts'], {
      capture: true,
      timeout: publication,
    }).trim(),
  );
  const rpc = new URL(process.env.BESU_RPC_URL ?? 'http://127.0.0.1:8545');
  if (!['http:', 'https:'].includes(rpc.protocol) || rpc.username || rpc.password)
    throw new Error('Use an explicit plain development ledger RPC.');
  if (![1337, 31337].includes(seeded.ledger.chainId))
    throw new Error(
      'Development ownership transfer requires the Besu or anvil development ledger.',
    );
  console.log('Handing the governance contracts to the TAO’s KMS key…');
  await handOver(rpc.href, [seeded.ledger.registry, seeded.ledger.governance], seeded.tao.address);
  console.log('Setting the TIs up on the governance contract…');
  const synchronized = JSON.parse(
    run(
      'docker',
      [...compose, 'exec', '-T', 'backend', 'node', 'scripts/sync-development-registry.ts'],
      {
        capture: true,
        timeout: publication,
      },
    ).trim(),
  );
  if (synchronized.governance_pending)
    throw new Error('A TI is not set up on the governance contract yet; see the backend log.');
  // Success means the new keys actually hold their roles; a pending policy timelock is not ready.
  const checked = JSON.parse(
    run(
      'docker',
      [...compose, 'exec', '-T', 'backend', 'node', 'scripts/check-development-ready.ts'],
      { capture: true },
    ).trim(),
  );
  console.log('Ready: ' + seeded.origin);
  console.log(
    'Accounts: alice (issuer/A), bob (status/B), supervisor (RootTAO/auditor/admin), mirri (TAO).',
  );
  console.log(
    'TAO ' + seeded.tao.did + ' owns the governance contracts with ' + seeded.tao.address + '.',
  );
  console.log(
    'Passwords are set only when accounts are created: PLR_DEV_PASSWORD, default Atest-2026!Demo',
  );
  console.log(
    'Registry, issuer keys and per-TI governance signers checked; unknown certificate standing: ' +
      checked.standing +
      '.',
  );
} catch (error) {
  console.error('Development bootstrap failed:', (error as Error).message);
  process.exitCode = 1;
}
