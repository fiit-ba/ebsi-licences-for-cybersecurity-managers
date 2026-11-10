import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { bootstrapRootAdministrator } from '../server/identity/administration/bootstrap.ts';

/**
 * Read an operator-supplied password from a private regular file.
 * @param path - Path to a file readable only by its owner.
 * @returns The password with one optional trailing newline removed.
 * @throws Filesystem errors or Error for public permissions, symlinks, wrong kind or oversize.
 */
async function passwordFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 2048) {
      throw new Error(
        'The password must be in a private regular file (chmod 600), at most 2048 bytes.',
      );
    }
    return (await file.readFile('utf8')).replace(/\r?\n$/, '');
  } finally {
    await file.close();
  }
}

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    email: { type: 'string' },
    'root-name': { type: 'string' },
    'password-file': { type: 'string' },
  },
});
if (!values.username || !values['root-name'] || !values['password-file']) {
  throw new Error(
    'Usage: npm run bootstrap:admin -- --username NAME --root-name ORGANIZATION --password-file PRIVATE_FILE [--email ADDRESS]',
  );
}
const password = await passwordFile(values['password-file']);
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
try {
  const result = await bootstrapRootAdministrator(database, {
    username: values.username,
    email: values.email ?? '',
    password,
    organization_name: values['root-name'],
  });
  console.log(JSON.stringify(result));
} finally {
  await database.end();
}
