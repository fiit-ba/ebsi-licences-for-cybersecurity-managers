import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const directory = new URL('./migrations/', import.meta.url);
const client = new pg.Client();
await client.connect();

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(780264150)');
  await client.query(`CREATE TABLE IF NOT EXISTS back_office_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT name FROM back_office_migrations');
  const applied = new Set(rows.map(({ name }) => name));
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    await client.query(await readFile(new URL(name, directory), 'utf8'));
    await client.query('INSERT INTO back_office_migrations(name) VALUES ($1)', [name]);
  }
  await client.query('COMMIT');
} finally {
  await client.end();
}
