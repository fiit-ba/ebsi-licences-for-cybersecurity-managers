import pg from 'pg';
import { synchronizeDevelopmentRegistry } from './development-registry.ts';

const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
try {
  const result = await synchronizeDevelopmentRegistry(database);
  console.log(JSON.stringify(result));
  if (result.pending || result.withdrawals_pending) process.exitCode = 1;
} finally {
  await database.end();
}
