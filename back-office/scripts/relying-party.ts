import pg from 'pg';
import { postgresRelyingParties } from '../server/verification/parties.ts';

const [action, name] = process.argv.slice(2);
if (!['create', 'list', 'revoke'].includes(action ?? '') || (action !== 'list' && !name))
  throw new Error('Usage: node scripts/relying-party.ts create|list|revoke [name]');
const database = new pg.Pool();
try {
  const parties = postgresRelyingParties(database);
  if (action === 'list') {
    for (const party of await parties.list())
      console.log(
        `${party.name}\t${party.active ? 'active' : 'revoked'}\tlast used ${party.last_used_at ?? 'never'}`,
      );
  } else if (action === 'create') {
    console.log((await parties.create(name!)).key);
    console.error('Shown once; only its digest is stored.');
  } else if (!(await parties.revoke(name!))) throw new Error('No relying party named ' + name);
  else console.log(name + ' revoked');
} finally {
  await database.end();
}
