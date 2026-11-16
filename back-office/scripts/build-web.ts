import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'web/dist');
const environment = { ...loadEnv('production', join(root, 'web'), 'VITE_'), ...process.env };
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'assets'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['web/src/main.tsx'],
  outdir: join(output, 'assets'),
  entryNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  metafile: true,
  legalComments: 'external',
  external: ['/fonts/*'],
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': JSON.stringify({
      DEV: false,
      VITE_GOVERNANCE_CONTRACT: environment.VITE_GOVERNANCE_CONTRACT ?? '',
      VITE_LEDGER_CHAIN_ID: environment.VITE_LEDGER_CHAIN_ID ?? '1337',
      VITE_LEDGER_RPC: environment.VITE_LEDGER_RPC ?? '',
      VITE_LEDGER_WALLET_RPC: environment.VITE_LEDGER_WALLET_RPC ?? '',
    }),
  },
});
const browserPackages = new Set<string>();
for (const input of Object.keys(result.metafile.inputs)) {
  if (input === '<define:import.meta.env>') continue;
  const absolute = resolve(root, input);
  if (
    ![join(root, 'web/src'), join(root, 'shared'), join(root, 'node_modules')].some((directory) =>
      absolute.startsWith(directory + sep),
    )
  ) {
    throw new Error(
      'Browser inputs must belong to web/src, public shared contracts or declared dependencies: ' +
        input,
    );
  }
  const parts = absolute.split(sep);
  const at = parts.lastIndexOf('node_modules');
  if (at >= 0)
    browserPackages.add(parts.slice(0, at + (parts[at + 1].startsWith('@') ? 3 : 2)).join(sep));
}
const notices: string[] = [];
for (const directory of [...browserPackages].sort()) {
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const licenses = (await readdir(directory)).filter((name) =>
    /^(licen[sc]e|copying|notice)(\..*)?$/i.test(name),
  );
  if (!licenses.length) throw new Error('Missing browser dependency license: ' + metadata.name);
  notices.push(
    `${metadata.name} ${metadata.version}\n${'='.repeat(64)}\n` +
      (await Promise.all(licenses.map((name) => readFile(join(directory, name), 'utf8')))).join(
        '\n',
      ),
  );
}
await writeFile(join(output, 'assets/licenses.txt'), notices.join('\n\n'));
const built = Object.keys(result.metafile.outputs);
const script = built.find(
  (name) => name.endsWith('.js') && result.metafile.outputs[name].entryPoint,
);
const style = built.find((name) => name.endsWith('.css'));
if (!script || !style) throw new Error('The console build must include JavaScript and CSS.');
const url = (path: string) => '/assets/' + path.split('/').at(-1);
await cp(join(root, 'web/public'), output, { recursive: true });
const template = await readFile(join(root, 'web/index.html'), 'utf8');
await writeFile(
  join(output, 'index.html'),
  template.replace(
    '<script type="module" src="/src/main.tsx"></script>',
    `<link rel="stylesheet" href="${url(style)}"><script type="module" src="${url(script)}"></script>`,
  ),
);
console.log(
  'Built the TypeScript console with ' + browserPackages.size + ' dependency license notices.',
);
