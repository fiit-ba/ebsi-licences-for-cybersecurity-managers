import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { JsonRpcProvider } from 'ethers';
import assert from 'node:assert/strict';
import { installationStatus, protectedReadProbeTimeoutMs } from '../checks/installation-http.ts';
import { startTestLedger } from '../server/lifecycle/fixtures/ledger.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = join(root, 'back-office');
const publicHost = process.env.PLR_TEST_PUBLIC_HOST;
if (!publicHost || /[/:\s]/.test(publicHost))
  throw new Error(
    'Set PLR_TEST_PUBLIC_HOST to a task-owned host reachable from containers and test clients.',
  );
const directory = await mkdtemp(join(tmpdir(), 'atest-installation-'));
const project = 'atest-installation-' + randomUUID().slice(0, 12);
/**
 * Choose an available task port without touching an existing listener.
 * @returns An ephemeral TCP port, released for the owned child/container.
 * @throws Listener errors.
 */
async function port() {
  const server = createServer();
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}

/**
 * Execute an owned setup/check command without shell interpolation or secret output.
 * @param command - Executable.
 * @param args - Literal arguments.
 * @param options - Working directory, environment and optional private stdin.
 * @returns Captured stdout; failures expose only a short redacted setup diagnostic.
 * @throws Error for a failed bounded command; full command output stays in its task log.
 */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {},
) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      input: options.input,
      encoding: 'utf8',
      timeout: options.timeout ?? 600_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    // Scripts in this runner print only safe diagnostics; no secret env/argv is dumped.
    throw new Error(
      String(failure.stderr ?? failure.stdout ?? 'Installation command failed.').slice(-4000),
    );
  }
}

const apiPort = await port();
const registryPort = await port();
const devPort = await port();
const envFile = join(directory, 'stack.env');
const stateFile = join(directory, 'state.json');
const passwordFile = join(directory, 'password');
const password = randomBytes(32).toString('base64url');
await writeFile(passwordFile, password, { mode: 0o600 });
// An owned anvil with EBSI's registries, the certificate registry and its governance (for the
// development TAO) and the development trust chain, deployed by contracts/ with Foundry;
// reachable from the containers.
// Unseeded, as start-mvp.sh deploys: bootstrap publishes the installation's own authorities.
const { record, anvil: ledger } = await startTestLedger({
  host: '0.0.0.0',
  seed: false,
  taoDid: 'did:ebsi:zmQaJTYt1ftvnjrwxWpPDUX',
});
const ledgerPort = new URL(record.rpc).port;
const provider = new JsonRpcProvider(record.rpc, undefined, { cacheTimeout: -1 });
let vite: ReturnType<typeof spawn> | undefined;
let composed = false;
let kmsPaused = false;
const composeArgs = [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  '-f',
  join(root, 'infra/docker-compose.yml'),
];
try {
  // The development EBSI service reads the deployment from records like contracts/deployments'.
  const deployments = join(directory, 'deployments');
  await mkdir(deployments);
  await writeFile(
    join(deployments, 'besu-ebsi.json'),
    JSON.stringify({
      ebsi: {
        DidRegistry: { contractAddress: record.didRegistry },
        IssuersRegistry: { contractAddress: record.issuersRegistry },
        SchemasRegistry: { contractAddress: record.schemasRegistry },
        Timestamp: { contractAddress: record.timestamp },
        PolicyRegistry: { contractAddress: record.policiesRegistry },
      },
    }),
  );
  await writeFile(
    join(deployments, 'besu.json'),
    JSON.stringify({
      CertificateGovernance: { address: record.governance },
      CertificateRegistry: { address: record.registry },
    }),
  );
  const settings = {
    PLR_DEV_PASSWORD: password,
    PLR_GOVERNANCE_RECONCILE_SECONDS: '2',
    PLR_STANDING_SWEEP_SECONDS: '2',
    PLR_PUBLIC_HOST: publicHost,
    PLR_BIND_ADDRESS: '0.0.0.0',
    PLR_API_PORT: String(apiPort),
    PLR_REGISTRY_PORT: String(registryPort),
    PLR_GOVERNANCE_CONTRACT: record.governance,
    PLR_CERTIFICATE_REGISTRY: record.registry,
    PLR_GOVERNANCE_TAO_DID: record.taoDid,
    PLR_DEPLOYMENTS_DIR: deployments,
    PLR_LEDGER_CHAIN_ID: String(record.chainId),
    // The backend writes through the EBSI service's Ledger API, which sends to this ledger.
    PLR_BESU_RPC_URL: 'http://host.docker.internal:' + ledgerPort,
    PLR_LEDGER_WALLET_RPC: 'http://' + publicHost + ':' + ledgerPort,
  };
  await writeFile(
    envFile,
    Object.entries(settings)
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  run('docker', [...composeArgs, 'config', '-q']);
  composed = true;
  console.log('Building ordinary product images and starting an isolated fresh installation.');
  run('docker', [...composeArgs, 'up', '--build', '-d', '--wait', '--wait-timeout', '180']);
  const bootstrapArgs = [
    join(root, 'infra/bootstrap.sh'),
    '--env-file',
    envFile,
    '--project-name',
    project,
  ];
  // Bootstrap hands the contracts to the TAO's KMS key on this ledger.
  const bootstrap = () =>
    run('bash', bootstrapArgs, {
      env: { ...process.env, BESU_RPC_URL: record.rpc },
      // Publication in the development registries is a few dozen ledger transactions.
      timeout: 1_800_000,
    });
  console.log(bootstrap().trim());
  const snapshotCode = `import pg from 'pg';const db=new pg.Pool();try{const result={};for(const [name,query] of Object.entries({fieldKeys:'SELECT * FROM field_keys',accounts:'SELECT id,username,password_hash,auth_version,active FROM operator_accounts ORDER BY id',organizations:'SELECT id,account_id,parent_id,kind,accredited_until FROM accredited_organizations ORDER BY id',schemas:'SELECT schema_id,version,fields,tsr_id FROM certificate_schema_versions ORDER BY schema_id,version',keys:'SELECT organization_id,kid,kms_key_id,public_jwk FROM issuer_signing_keys ORDER BY organization_id,kid',roles:'SELECT account_id,role FROM operator_governance_roles ORDER BY account_id,role'})){result[name]=(await db.query(query)).rows;}console.log(JSON.stringify(result));}finally{await db.end();}`;
  const snapshotCommand = [
    ...composeArgs,
    'exec',
    '-T',
    'backend',
    'node',
    '--input-type=module',
    '-e',
    snapshotCode,
  ];
  const firstSeed = run('docker', snapshotCommand);
  console.log(bootstrap().trim());
  assert.equal(
    run('docker', snapshotCommand),
    firstSeed,
    'Repeated bootstrap changed accounts, passwords, hierarchy, schema versions or keys.',
  );
  run('docker', [...composeArgs, 'restart', 'ebsi-mock']);
  run('docker', [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', '90', 'ebsi-mock']);
  console.log(bootstrap().trim());
  assert.equal(
    run('docker', snapshotCommand),
    firstSeed,
    'Registry restart/bootstrap changed durable installation identities.',
  );
  console.log(
    'Ordinary bootstrap: all demo seeds, repeated execution and mock restart recovery preserved identities/passwords/schema versions/keys.',
  );
  const env = {
    ...process.env,
    ATEST_INSTALLATION_TEST: 'isolated',
    BACK_OFFICE_ACCEPTANCE_COMPOSE_PROJECT: project,
    BACK_OFFICE_ACCEPTANCE_COMPOSE_ENV: envFile,
    BACK_OFFICE_ACCEPTANCE_ORIGIN: 'http://' + publicHost + ':' + apiPort,
    BACK_OFFICE_ACCEPTANCE_USERNAME: 'supervisor',
    BACK_OFFICE_ACCEPTANCE_SEEDED: 'true',
    BACK_OFFICE_ACCEPTANCE_PASSWORD_FILE: passwordFile,
    BACK_OFFICE_ACCEPTANCE_STATE_FILE: stateFile,
    BACK_OFFICE_ACCEPTANCE_RPC_URL: 'http://127.0.0.1:' + ledgerPort,
  };
  console.log(run(process.execPath, ['checks/installation.ts'], { cwd: packageRoot, env }).trim());
  run('docker', [
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'createdb',
    '-U',
    'atest',
    'atest_field_key_transition',
  ]);
  const transitionCommand = [
    ...composeArgs,
    'exec',
    '-T',
    '-e',
    'PGDATABASE=atest_field_key_transition',
    '-e',
    'ATEST_INSTALLATION_TEST=isolated',
    'backend',
    'node',
  ];
  run('docker', [...transitionCommand, 'data/migrate.ts']);
  const transitionSource = (
    await readFile(join(packageRoot, 'checks/field-key-transition.ts'), 'utf8')
  ).replaceAll('../server/', './server/');
  const transition = (phase: string) =>
    run(
      'docker',
      [
        ...transitionCommand,
        '--experimental-strip-types',
        '--input-type=module-typescript',
        '-',
        phase,
      ],
      { input: transitionSource },
    );
  console.log(transition('prepare').trim());
  console.log(transition('migrate').trim());
  // Compare actual provider public material across a complete KMS restart, not
  // merely the persisted locators (which can outlive a volatile emulator key).
  const inspectKeys = `import pg from 'pg';import {KMSClient,GetPublicKeyCommand} from '@aws-sdk/client-kms';import {createHash} from 'node:crypto';const db=new pg.Pool();const kms=new KMSClient({region:process.env.AWS_REGION,endpoint:process.env.PLR_KMS_ENDPOINT_URL});try{const rows=(await db.query('SELECT DISTINCT kms_key_id FROM issuer_signing_keys ORDER BY kms_key_id')).rows;const result=[];for(const row of rows){const key=await kms.send(new GetPublicKeyCommand({KeyId:row.kms_key_id}));result.push([row.kms_key_id,createHash('sha256').update(key.PublicKey).digest('hex')]);}console.log(JSON.stringify(result));}finally{kms.destroy();await db.end();}`;
  const keyCommand = [
    ...composeArgs,
    'exec',
    '-T',
    'backend',
    'node',
    '--input-type=module',
    '-e',
    inspectKeys,
  ];
  const beforeKeys = run('docker', keyCommand);
  run('docker', [...composeArgs, 'restart', 'kms']);
  run('docker', [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', '90', 'kms']);
  assert.equal(
    run('docker', keyCommand),
    beforeKeys,
    'KMS restart lost or replaced actual signing material.',
  );
  console.log(transition('read').trim());
  console.log('Persisted registry/TI, A/B and wrapped field keys survived provider restart.');
  console.log(
    run(process.execPath, ['checks/background-installation.ts'], { cwd: packageRoot, env }).trim(),
  );
  console.log(
    run(process.execPath, ['checks/installation-lifecycle.ts'], { cwd: packageRoot, env }).trim(),
  );
  run('docker', [...composeArgs, 'restart', 'backend']);
  for (let i = 0; ; i++) {
    try {
      if ((await installationStatus(env.BACK_OFFICE_ACCEPTANCE_ORIGIN + '/health/ready')) === 200)
        break;
    } catch {}
    if (i === 100) throw new Error('Restart readiness failed.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(transition('read').trim());
  const origin = env.BACK_OFFICE_ACCEPTANCE_ORIGIN;
  const session = await fetch(origin + '/api/api-token-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'supervisor', password }),
  });
  assert.equal(session.status, 200);
  const access = (await session.json()).access;
  const readCertificates = () =>
    installationStatus(
      origin + '/registry/certificates/',
      { authorization: 'Bearer ' + access },
      protectedReadProbeTimeoutMs,
    );
  assert.equal(await readCertificates(), 200);
  const beforeOutage = run('docker', snapshotCommand);
  // A paused provider accepts connections but cannot respond, exercising the SDK's
  // actual deadline instead of depending on platform-specific connection refusal.
  run('docker', [...composeArgs, 'pause', 'kms']);
  kmsPaused = true;
  assert.equal(
    await readCertificates(),
    200,
    'A warm process lost its already unwrapped key during KMS outage.',
  );
  run('docker', [...composeArgs, 'restart', 'backend']);
  for (let i = 0; ; i++) {
    try {
      if ((await installationStatus(origin + '/health/ready')) === 200) break;
    } catch {}
    if (i === 100) throw new Error('Cold outage readiness failed.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const coldReadStarted = Date.now();
  assert.equal(
    await readCertificates(),
    503,
    'A cold backend must refuse encrypted reads without KMS.',
  );
  console.log(
    'Cold API refused paused KMS with HTTP 503 after ' + (Date.now() - coldReadStarted) + 'ms.',
  );
  run('docker', [...composeArgs, 'unpause', 'kms']);
  kmsPaused = false;
  run('docker', [...composeArgs, 'stop', 'kms']);
  console.log(transition('unavailable').trim());
  assert.equal(run('docker', snapshotCommand), beforeOutage);
  run('docker', [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', '90', 'kms']);
  assert.equal(
    await readCertificates(),
    200,
    'Cold key loading did not recover after KMS returned.',
  );
  console.log(transition('read').trim());
  console.log(
    'Warm-memory continuity, cold HTTP 503, unchanged durable keys and recovery after KMS outage passed.',
  );
  console.log(run('npm', ['run', 'test:installation:web'], { cwd: packageRoot, env }).trim());
  vite = spawn(
    process.execPath,
    [
      join(packageRoot, 'node_modules/vite/bin/vite.js'),
      '--config',
      'web/vite.config.ts',
      '--port',
      String(devPort),
    ],
    {
      cwd: packageRoot,
      env: {
        ...env,
        BACK_OFFICE_DEV_API_URL: env.BACK_OFFICE_ACCEPTANCE_ORIGIN,
        PLR_LEDGER_RPC_URL: 'http://127.0.0.1:' + ledgerPort,
      },
      stdio: 'ignore',
    },
  );
  const devOrigin = 'http://127.0.0.1:' + devPort;
  for (let i = 0; ; i++) {
    try {
      if ((await installationStatus(devOrigin)) === 200) break;
    } catch {}
    if (i === 100) throw new Error('Vite did not start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    run('npm', ['run', 'test:installation:web'], {
      cwd: packageRoot,
      env: { ...env, BACK_OFFICE_ACCEPTANCE_ORIGIN: devOrigin },
    }).trim(),
  );
  assert.equal(ledger.exitCode, null);
  console.log(
    'Ordinary Compose fresh install, bootstrap, workers, restart and built/dev browser checks passed.',
  );
} finally {
  if (vite && vite.exitCode === null) {
    const done = once(vite, 'exit');
    vite.kill('SIGTERM');
    await done;
  }
  if (composed) {
    if (kmsPaused) run('docker', [...composeArgs, 'unpause', 'kms']);
    run('docker', [...composeArgs, 'stop', '--timeout', '90']);
  }
  provider.destroy();
  if (ledger.exitCode === null) {
    const done = once(ledger, 'exit');
    ledger.kill('SIGTERM');
    await done;
  }
  await rm(directory, { recursive: true, force: true });
  console.log(
    'Stopped only the owned installation/ledger/Vite resources; volumes were retained. Project: ' +
      project,
  );
}
