import pg from 'pg';
import { initializeDevelopmentRegistry } from './development-registry.ts';

const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
try {
  console.log(JSON.stringify(await initializeDevelopmentRegistry(database)));
} finally {
  await database.end();
}
