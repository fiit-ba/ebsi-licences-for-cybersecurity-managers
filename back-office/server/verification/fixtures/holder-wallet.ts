import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { AddressInfo } from 'node:net';

/**
 * Execute the actual Wallet exchange/session/crypto over loopback HTTP without native UI.
 * @param listener - Optional task-owned bind/public host for a container reaching the Wallet.
 * @returns Factory for Wallet HolderExchange instances and an owned listener.
 * @throws Source compilation, crypto or listener errors.
 * @remarks Only react-native-quick-crypto is mapped to Node crypto; Wallet protocol/state/envelope code is unchanged.
 */
export async function actualHolderWallet(
  listener = { host: '127.0.0.1', publicHost: '127.0.0.1' },
) {
  const wallet = fileURLToPath(new URL('../../../../holder-wallet/', import.meta.url));
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const built = await build({
    entryPoints: [wallet + 'src/infrastructure/exchange/session.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    nodePaths: [packageRoot + 'node_modules'],
    alias: {
      'react-native-quick-crypto': 'node:crypto',
      '@infrastructure': wallet + 'src/infrastructure',
    },
    tsconfigRaw: { compilerOptions: { target: 'ES2024' } },
    banner: {
      js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(packageRoot + 'package.json')});`,
    },
  });
  const source = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const exchanges = new Map<string, any>();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const id = request.url?.split('/')[2];
    const exchange = exchanges.get(id ?? '');
    const result = exchange
      ? exchange.handle(
          request.method,
          request.url,
          request.headers,
          Buffer.concat(chunks).toString('utf8'),
        )
      : { status: 404, body: {} };
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  server.listen(0, listener.host);
  await once(server, 'listening');
  const origin = 'http://' + listener.publicHost + ':' + (server.address() as AddressInfo).port;
  return {
    /**
     * Open a Wallet exchange for one holder decision.
     * @param onRequest - Optional simulated holder action after a request arrives.
     * @returns Actual HolderExchange and its invitation.
     */
    create(onRequest?: (query: Record<string, any>) => void) {
      const exchange = new source.HolderExchange(origin, { onRequest });
      exchanges.set(exchange.id, exchange);
      return exchange;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
