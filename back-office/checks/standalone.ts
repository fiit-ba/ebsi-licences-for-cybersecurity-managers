import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const forbidden =
  /(?:\.\.\/)+archive\/|(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*archive\/|git\s+(?:show|fetch|clone)/;
const excluded = new Set([
  'node_modules',
  '.git',
  'archive',
  'dist',
  'build',
  'artifacts',
  'cache',
  'test-results',
  'playwright-report',
  'ios',
  'android',
  'design',
  'assets',
  'public',
]);
const failures: string[] = [];

/**
 * Inspect authored executable/configuration sources without needing Git or historical data.
 * @param directory - Current product directory.
 * @returns Completion after recording any archive or source-fetch dependencies.
 * @throws Filesystem read errors.
 */
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    // Besu's chain data and the Solidity libraries `forge soldeer install` unpacks (ignored by
    // Git, like node_modules) are not authored product code.
    if (
      ['infra/besu/besu-qbft-network/data', 'contracts/dependencies'].includes(
        relative(root, join(directory, entry.name)),
      )
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (
      entry.isFile() &&
      (/\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|sh|template)$/.test(entry.name) ||
        entry.name === 'Dockerfile')
    ) {
      if (path === fileURLToPath(import.meta.url) || /(?:package-lock|yarn\.lock)/.test(entry.name))
        continue;
      if (forbidden.test(await readFile(path, 'utf8'))) failures.push(relative(root, path));
    }
  }
}
// Explicit package entry points must exist; dependency-provided executables stay with their package.
for (const directory of ['back-office', 'contracts', 'infra/ebsi-mock', 'holder-wallet']) {
  const metadata = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(metadata.scripts ?? {})) {
    for (const [, target] of String(command).matchAll(
      /\b(?:node|python3?|bash)\s+((?:scripts|checks|server|src|data)\/[^\s;&|]+)/g,
    )) {
      await access(join(root, directory, target)).catch(() => {
        throw new Error(
          directory + ' script ' + name + ' references a missing entry point: ' + target,
        );
      });
    }
  }
}
for (const directory of ['back-office', 'contracts', 'infra', 'holder-wallet', '.github'])
  await inspect(join(root, directory));
assert.deepEqual(failures, [], 'Product code depends on archive or fetched source.');
console.log(
  'Current package entry points exist; product code has no archive or source-fetch dependency.',
);
