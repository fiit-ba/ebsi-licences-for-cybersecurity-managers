import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Load the Wallet's unchanged organization, discovery/token/collection and SD-JWT clients.
 * @param origin - Explicit installation under test.
 * @returns Actual Axios/fetch consumer operations and disclosure decoding.
 * @throws Source compilation, dependency or module evaluation errors.
 * @remarks Only the build-time API origin and native crypto binding are adapted.
 */
export async function actualWalletClients(origin: string) {
  const wallet = fileURLToPath(new URL('../../../../holder-wallet/', import.meta.url));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const built = await build({
    stdin: {
      contents: `export * from '${wallet}src/infrastructure/organization/organization.client.ts';export * from '${wallet}src/infrastructure/openid/openid.client.ts';export * from '${wallet}src/domain/credentials/sdJwt.ts';`,
      resolveDir: wallet,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    alias: {
      '@infrastructure': wallet + 'src/infrastructure',
      axios: root + 'node_modules/axios',
      jose: root + 'node_modules/jose',
      'react-native-quick-crypto': 'node:crypto',
    },
    define: { 'process.env.BACKOFFICE_URL': JSON.stringify(origin) },
    tsconfigRaw: { compilerOptions: { target: 'ES2024' } },
    banner: {
      js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(root + 'package.json')});`,
    },
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
}
