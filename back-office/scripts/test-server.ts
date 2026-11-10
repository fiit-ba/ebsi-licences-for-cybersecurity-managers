import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/**
 * Discover colocated server checks without traversing external package dependencies.
 * @param directory - Owned server source directory relative to the package root.
 * @returns Paths to every authored server test, including domain integration scenarios.
 * @throws Filesystem errors when a source directory cannot be enumerated.
 */
async function serverTests(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await serverTests(path)));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const files = await serverTests('server');
// One development ledger and EBSI service for the whole run (contracts deployed with Foundry),
// unless the environment names them already.
const owned: { kill(): void }[] = [];
if (!process.env.BACK_OFFICE_TEST_LEDGER) {
  const { startTestLedger, startTestEbsi } = await import('../server/lifecycle/fixtures/ledger.ts');
  const { record, anvil } = await startTestLedger();
  owned.push(anvil);
  process.env.BACK_OFFICE_TEST_LEDGER = JSON.stringify(record);
  if (!process.env.BACK_OFFICE_TEST_EBSI_URL) {
    const { base, service } = await startTestEbsi(record);
    owned.push(service);
    process.env.BACK_OFFICE_TEST_EBSI_URL = base;
  }
}
process.once('exit', () => owned.forEach((child) => child.kill()));
// Sort by filename first: shared immutable journal/outbox fixtures expect their
// initial checks to run before the other integration scenarios.
files.sort(
  (left, right) =>
    basename(left).localeCompare(basename(right), 'en') || left.localeCompare(right, 'en'),
);
if (!files.length) throw new Error('No colocated server tests were discovered.');
// Node's CLI sorts paths again during discovery, ignoring the order above.
// Launch each file explicitly so moving a test cannot reorder shared fixtures.
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0 };
let failed = false;
let interrupted = false;
for (const file of files) {
  const child = spawn(
    process.execPath,
    ['--test', '--test-reporter=tap', ...process.argv.slice(2), file],
    { stdio: ['inherit', 'pipe', 'inherit'] },
  );
  const forward = (signal: NodeJS.Signals) => {
    interrupted = true;
    return child.kill(signal);
  };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    output = (output + chunk.toString()).slice(-8000);
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  for (const key of Object.keys(totals) as (keyof typeof totals)[])
    totals[key] += Number(output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0);
  failed ||= code !== 0;
  if (interrupted) break;
}
console.log('Server test totals: ' + JSON.stringify(totals));
process.exitCode = failed ? 1 : 0;
