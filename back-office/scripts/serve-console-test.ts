import { createServer } from 'node:http';
import { loadConsoleAssets } from '../server/http/console.ts';

const port = Number(process.env.BACK_OFFICE_WEB_TEST_PORT ?? 8789);
const assets = await loadConsoleAssets(new URL('../web/dist/', import.meta.url));
const server = createServer((request, response) => {
  if (assets(request, response)) return;
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ detail: 'Not found.' }));
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
