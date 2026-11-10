import pg from 'pg';
import { hostname } from 'node:os';
import { configuredDomains } from '../runtime.ts';
import { backgroundQueue } from '../background/queue.ts';
import { backgroundHandlers } from '../background/handlers.ts';
import { backgroundRuntime } from '../background/runtime.ts';

const url = process.env.REDIS_BROKER_URL;
if (!url) throw new Error('REDIS_BROKER_URL is required for the worker.');
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
database.on('error', () => console.error('Worker idle database connection failed.'));
const domains = await configuredDomains(database);
const queue = backgroundQueue(url);
const runtime = await backgroundRuntime(url, backgroundHandlers(database, domains, queue), queue, {
  name: hostname(),
});
console.log('Background worker ready.');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void runtime
      .close()
      .then(async () => {
        await queue.close();
        await domains.close();
        await database.end();
      })
      .catch(() => {
        console.error('Background shutdown failed.');
        process.exitCode = 1;
      });
  });
}
