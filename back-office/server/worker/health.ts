import pg from 'pg';
import { hostname } from 'node:os';
import { backgroundQueue } from '../background/queue.ts';

const database = new pg.Pool({ connectionTimeoutMillis: 2000 });
const queue = backgroundQueue(process.env.REDIS_BROKER_URL!, true);
try {
  await database.query('SELECT 1 FROM audit_head WHERE singleton');
  const workers = await queue.getWorkers();
  if (!workers.some((worker) => worker.rawname?.endsWith(':w:' + hostname())))
    throw new Error('Worker connection missing.');
  if ((await queue.getJobSchedulersCount()) !== 6) throw new Error('Background schedules missing.');
} catch {
  process.exitCode = 1;
} finally {
  await queue.close();
  await database.end();
}
