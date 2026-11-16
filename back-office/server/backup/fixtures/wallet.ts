import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Bundle actual Wallet backup, restore, keychain repository and PIN-session code headlessly.
 * @returns Unchanged Wallet operations and test-only in-memory native boundary controls.
 * @throws Source compilation or dependency errors.
 * @remarks Axios, HTTP responses, proof, encryption, phrase derivation, identity install,
 * merge and persistence repositories are real. Only native OS storage/crypto bindings,
 * unused native modules and the configured server origin are replaced.
 */
export async function actualBackupWallet() {
  const wallet = fileURLToPath(new URL('../../../../holder-wallet/', import.meta.url));
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const modules: Record<string, string> = {
    'react-native-keychain': `let saved=false;export const getGenericPassword=async()=>saved;export const setGenericPassword=async(username,password)=>{saved={username,password};return true};export const resetGenericPassword=async()=>{saved=false;return true};`,
    '@react-native-async-storage/async-storage': `const values=new Map();export default {setItem:async(k,v)=>{values.set(k,v)},getItem:async(k)=>values.get(k)??null,removeItem:async(k)=>{values.delete(k)},clear:async()=>values.clear()};`,
    '@infrastructure/config/Backoffice': `let origin='';export const backofficeUrl=()=>origin;export const isBackofficeConfigured=()=>Boolean(origin);export const setOrigin=(value)=>{origin=value};`,
    '@infrastructure/persistence/keychain': `export {readWallet as getKeychainDataObject,writeWallet as setKeychainDataObject} from '${wallet}src/infrastructure/persistence/keychain/keychain.adapter.ts';export {getPrivateKey,saveJWKKeys} from '${wallet}src/infrastructure/persistence/keychain/identity.repository.ts';`,
    '@ethersproject/shims': '',
    'react-native-get-random-values': '',
    'react-native-libsodium': 'export default {ready:Promise.resolve()};',
    '@dreson4/react-native-quick-bip39': `export const generateMnemonic=()=>{throw new Error('Not used in restore checks')};`,
  };
  const built = await build({
    stdin: {
      contents: `export * from '${wallet}src/infrastructure/backup/index.ts';export * from '${wallet}src/infrastructure/backup/keys.ts';export {proof,digest,open,seal} from '${wallet}src/infrastructure/backup/envelope.ts';export {identityKeyOf,restoreWallet} from '${wallet}src/infrastructure/wallet/wallet.service.ts';export * from '@infrastructure/persistence/keychain';export {SessionPin} from '${wallet}src/infrastructure/security/SessionPin.ts';export {default as storage} from '${wallet}src/infrastructure/storage/index.ts';export {resetGenericPassword} from 'react-native-keychain';export {setOrigin} from '@infrastructure/config/Backoffice';`,
      resolveDir: wallet,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    nodePaths: [packageRoot + 'node_modules'],
    alias: {
      'react-native-quick-crypto': 'node:crypto',
      axios: packageRoot + 'node_modules/axios',
      ethers: packageRoot + 'node_modules/wallet-ethers',
      'ethereumjs-wallet': packageRoot + 'node_modules/ethereumjs-wallet',
      'ethereumjs-util': packageRoot + 'node_modules/ethereumjs-util',
      bs58: packageRoot + 'node_modules/bs58',
      jose: packageRoot + 'node_modules/jose',
      '@infrastructure': wallet + 'src/infrastructure',
      '@domain': wallet + 'src/domain',
      '@shared': wallet + 'src/shared',
    },
    tsconfigRaw: { compilerOptions: { target: 'ES2024' } },
    banner: {
      js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(packageRoot + 'package.json')});`,
    },
    plugins: [
      {
        name: 'native-boundaries',
        /**
         * Bind native OS dependencies to explicit headless test adapters.
         * @param plugin - esbuild plugin registration interface.
         * @returns No value; only module-resolution hooks are installed.
         */
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            args.path in modules ? { path: args.path, namespace: 'test-native' } : undefined,
          );
          plugin.onLoad({ filter: /.*/, namespace: 'test-native' }, (args) => ({
            contents: modules[args.path],
            loader: 'ts',
            resolveDir: wallet,
          }));
        },
      },
    ],
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
}
