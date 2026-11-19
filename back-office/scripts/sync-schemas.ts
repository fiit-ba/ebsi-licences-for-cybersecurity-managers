import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Copy the registry's JSON Schemas from `/schemas` (beside this package) into
 * `shared/schemas.json`, which the back-office reads: its image is built from this package alone.
 * `--check` fails when the copy differs, without writing.
 */
const root = fileURLToPath(new URL('../../schemas/', import.meta.url));
const target = new URL('../shared/schemas.json', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(root + path, 'utf8'));
const ebsi = Object.fromEntries(
  readdirSync(root + 'ebsi')
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => [name.replace(/\.json$/, ''), read('ebsi/' + name)]),
);
const bundle = {
  _generated: 'From /schemas by scripts/sync-schemas.ts; edit those files, not this one.',
  cybersecurityManagerCertificate: read('cybersecurity-manager-certificate/1.0.0/schema.json'),
  certificateStatusEntry: read('certificate-status-entry/1.0.0/schema.json'),
  ebsi,
};
const text = JSON.stringify(bundle, null, 2) + '\n';
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Missing counts as stale.
  }
  if (current !== text) {
    console.error('shared/schemas.json is stale: run node scripts/sync-schemas.ts.');
    process.exit(1);
  }
  console.log('shared/schemas.json matches /schemas.');
} else {
  writeFileSync(target, text);
  console.log('Wrote shared/schemas.json.');
}
